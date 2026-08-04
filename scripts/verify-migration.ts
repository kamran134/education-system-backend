/**
 * Сверка после ETL: Mongo-копия vs Postgres. Только чтение с обеих сторон,
 * ничего не пишет. Независима от etl-mongo-to-pg.ts: пересчитывает те же
 * известные исключения (дубли Student.code, пользователи с висячими
 * ссылками) заново по тем же правилам, а не переиспользует код ETL — иначе
 * сверка проверяла бы скрипт сам через себя.
 *
 * Проверки (PG_MIGRATION_TASKS.md шаг 4):
 *   1. Количество записей коллекция↔таблица (с поправкой на известные исключения)
 *   2. SUM(score) по ученикам/учителям/школам/районам за каждый год
 *   3. 25 случайных учеников — полное сравнение полей и связей
 *   4. Отсутствие NULL там, где в Mongo была реальная ссылка (кроме известных исключений)
 *
 * Запуск (та же docker-сеть, что и ETL):
 *   MONGO_URL=mongodb://mongo-etl-tmp:27017/kpm \
 *   PG_URL=postgres://isim:$PG_PASSWORD@isim-pg:5432/isim \
 *   npx ts-node verify-migration.ts
 */

import { MongoClient, ObjectId, Db } from "mongodb";
import { Client as PgClient } from "pg";

const MONGO_URL = process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm";
const PG_URL = process.env.PG_URL;
if (!PG_URL) {
    console.error("PG_URL не задан (postgres://isim:<пароль>@isim-pg:5432/isim)");
    process.exit(1);
}

function hex(id: ObjectId | null | undefined): string | null {
    if (!id) return null;
    return id.toHexString ? id.toHexString() : String(id);
}

let mismatchCount = 0;
function ok(label: string) { console.log(`ok   ${label}`); }
function mismatch(label: string, detail: string) { mismatchCount++; console.log(`XX   ${label}: ${detail}`); }

async function main() {
    const mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    const db = mongoClient.db();

    const pg = new PgClient({ connectionString: PG_URL });
    await pg.connect();

    try {
        // ================================================================ пересчёт известных исключений
        const studentsSrc = await db.collection("students").find({}).toArray();
        const byCode = new Map<number, typeof studentsSrc>();
        for (const s of studentsSrc) {
            if (!byCode.has(s.code)) byCode.set(s.code, []);
            byCode.get(s.code)!.push(s);
        }
        const excludedStudentIds = new Set<string>();
        for (const [, docs] of byCode) {
            if (docs.length > 1) for (const d of docs) excludedStudentIds.add(hex(d._id)!);
        }

        const districtsSrc = await db.collection("districts").find({}).toArray();
        const schoolsSrc = await db.collection("schools").find({}).toArray();
        const teachersSrc = await db.collection("teachers").find({}).toArray();
        // Известное исключение (найдено 04.08.2026): школы без district — подтверждённый мусор
        // (districtCode:0, одинаковое имя у всех, 0 ссылок откуда-либо). ETL их не переносит.
        const excludedSchoolIds = new Set(schoolsSrc.filter((s) => !s.district).map((s) => hex(s._id)!));
        const districtIdsSet = new Set(districtsSrc.map((d) => hex(d._id)));
        const schoolIdsSet = new Set(schoolsSrc.filter((s) => !excludedSchoolIds.has(hex(s._id)!)).map((s) => hex(s._id)));
        const teacherIdsSet = new Set(teachersSrc.map((t) => hex(t._id)));
        const studentIdsSet = new Set(studentsSrc.filter((s) => !excludedStudentIds.has(hex(s._id)!)).map((s) => hex(s._id)));

        // Правило: для student/teacher/schoolDirector/districtRepresenter привязка к своей сущности
        // обязательна (не задана или ссылается на удалённую/дубль-исключённую сущность → аккаунт пустой).
        // Другие роли (admin/superadmin/moderator) ничего не обязаны.
        const usersSrc = await db.collection("users").find({}).toArray();
        const ROLE_REQUIRED_FIELD: Record<string, string> = {
            student: "studentId", teacher: "teacherId", schoolDirector: "schoolId", districtRepresenter: "districtId",
        };
        const excludedUserIds = new Set<string>();
        for (const u of usersSrc) {
            const requiredField = ROLE_REQUIRED_FIELD[u.role];
            if (!requiredField) continue;
            const refId = (u as any)[requiredField];
            const h = hex(refId);
            const targetSet = requiredField === "districtId" ? districtIdsSet : requiredField === "schoolId" ? schoolIdsSet : requiredField === "teacherId" ? teacherIdsSet : studentIdsSet;
            if (!h || !targetSet.has(h)) excludedUserIds.add(hex(u._id)!);
        }

        console.log(`Известные исключения (пересчитаны независимо от ETL): дублей студентов ${excludedStudentIds.size}, пользователей с висячими ссылками ${excludedUserIds.size}\n`);

        // ================================================================ 1. количество записей
        console.log("=== 1. Количество записей ===");
        async function checkCount(label: string, mongoCount: number, pgTable: string, delta = 0) {
            const res = await pg.query(`SELECT count(*)::int AS c FROM ${pgTable}`);
            const pgCount = res.rows[0].c;
            const expected = mongoCount - delta;
            if (pgCount === expected) ok(`${label}: ${pgCount}` + (delta ? ` (mongo ${mongoCount} - ${delta} известных исключений)` : ""));
            else mismatch(label, `mongo=${mongoCount}, ожидалось pg=${expected} (delta=${delta}), реально pg=${pgCount}`);
        }

        const examsSrc = await db.collection("exams").find({}).toArray();
        const resultsSrc = await db.collection("studentresults").find({}).toArray();
        const bookletsSrc = await db.collection("booklets").find({}).toArray();
        const settingsSrc = await db.collection("usersettings").find({}).toArray();
        const logsSrc = await db.collection("gradepromotionlogs").find({}).toArray();

        const excludedResultsCount = resultsSrc.filter((r) => {
            const h = hex(r.student);
            return h && excludedStudentIds.has(h);
        }).length;

        await checkCount("districts", districtsSrc.length, "districts");
        await checkCount("schools", schoolsSrc.length, "schools", excludedSchoolIds.size);
        await checkCount("teachers", teachersSrc.length, "teachers");
        await checkCount("students", studentsSrc.length, "students", excludedStudentIds.size);
        await checkCount("exams", examsSrc.length, "exams");
        await checkCount("student_results", resultsSrc.length, "student_results", excludedResultsCount);
        await checkCount("booklets", bookletsSrc.length, "booklets");
        await checkCount("users", usersSrc.length, "users", excludedUserIds.size);
        await checkCount("grade_promotion_logs", logsSrc.length, "grade_promotion_logs");

        // usersettings: дедуп по нормализованному userId (оставляем свежую по updatedAt) +
        // пропуск для исключённых пользователей (не считая global) — оба типа делают дельту переменной,
        // поэтому считаем ожидаемое количество тем же способом, что и ETL, а не одним числом.
        const settingsByNormId = new Map<string, typeof settingsSrc>();
        for (const s of settingsSrc) {
            const h = typeof s.userId === "object" && s.userId?.toHexString ? s.userId.toHexString() : String(s.userId);
            if (!settingsByNormId.has(h)) settingsByNormId.set(h, []);
            settingsByNormId.get(h)!.push(s);
        }
        const usersMongoIdSet = new Set(usersSrc.map((u) => hex(u._id)));
        let expectedSettingsCount = 0;
        for (const [normId, docs] of settingsByNormId) {
            if (normId === "global") { expectedSettingsCount += 1; continue; }
            if (excludedUserIds.has(normId)) continue; // пропущено, как в ETL
            if (!usersMongoIdSet.has(normId)) continue; // осиротевшая запись, как в ETL
            expectedSettingsCount += 1; // дедуп: из N дублей выживает 1
        }
        {
            const res = await pg.query(`SELECT count(*)::int AS c FROM user_settings`);
            const pgCount = res.rows[0].c;
            if (pgCount === expectedSettingsCount) ok(`user_settings: ${pgCount} (mongo ${settingsSrc.length} документов, после дедупа/исключений ожидалось ${expectedSettingsCount})`);
            else mismatch("user_settings", `ожидалось ${expectedSettingsCount}, реально ${pgCount}`);
        }

        // user_refresh_tokens: сумма refreshTokens[] только у не исключённых пользователей
        const expectedTokens = usersSrc
            .filter((u) => !excludedUserIds.has(hex(u._id)!))
            .reduce((n, u) => n + (u.refreshTokens?.length ?? 0), 0);
        await checkCount("user_refresh_tokens", expectedTokens, "user_refresh_tokens");

        // *_year_ratings: количество (entity, year) пар после дедупа года внутри ratings[] массива
        function countRatingPairs(docs: any[], excluded?: Set<string>) {
            let n = 0;
            for (const d of docs) {
                if (excluded?.has(hex(d._id)!)) continue;
                const years = new Set((d.ratings ?? []).map((r: any) => r.year));
                n += years.size;
            }
            return n;
        }
        await checkCount("district_year_ratings", countRatingPairs(districtsSrc), "district_year_ratings");
        await checkCount("school_year_ratings", countRatingPairs(schoolsSrc, excludedSchoolIds), "school_year_ratings");
        await checkCount("teacher_year_ratings", countRatingPairs(teachersSrc), "teacher_year_ratings");
        await checkCount("student_year_ratings", countRatingPairs(studentsSrc, excludedStudentIds), "student_year_ratings");

        // ================================================================ 2. SUM(score) по годам
        console.log("\n=== 2. SUM(score) по годам ===");
        async function checkYearSums(label: string, docs: any[], pgTable: string, excluded?: Set<string>) {
            const mongoByYear = new Map<number, number>();
            for (const d of docs) {
                if (excluded?.has(hex(d._id)!)) continue;
                const seenYears = new Set<number>();
                for (const r of d.ratings ?? []) {
                    if (seenYears.has(r.year)) continue; // как в ETL: при дублирующемся годе берём один
                    seenYears.add(r.year);
                    mongoByYear.set(r.year, (mongoByYear.get(r.year) ?? 0) + (r.score ?? 0));
                }
            }
            const res = await pg.query(`SELECT year, SUM(score) AS s FROM ${pgTable} GROUP BY year ORDER BY year`);
            const pgByYear = new Map<number, number>(res.rows.map((r: any) => [r.year, Number(r.s)]));
            const years = new Set([...mongoByYear.keys(), ...pgByYear.keys()]);
            let allOk = true;
            for (const y of [...years].sort()) {
                const m = mongoByYear.get(y) ?? 0, p = pgByYear.get(y) ?? 0;
                if (Math.abs(m - p) > 1e-6) { mismatch(`${label} ${y}`, `mongo SUM=${m}, pg SUM=${p}`); allOk = false; }
            }
            if (allOk) ok(`${label}: ${years.size} лет, все суммы совпали`);
        }
        await checkYearSums("district_year_ratings", districtsSrc, "district_year_ratings");
        await checkYearSums("school_year_ratings", schoolsSrc, "school_year_ratings", excludedSchoolIds);
        await checkYearSums("teacher_year_ratings", teachersSrc, "teacher_year_ratings");
        await checkYearSums("student_year_ratings", studentsSrc, "student_year_ratings", excludedStudentIds);

        // ================================================================ 3. случайные ученики
        console.log("\n=== 3. 25 случайных учеников — полное сравнение ===");
        const validStudents = studentsSrc.filter((s) => !excludedStudentIds.has(hex(s._id)!));
        const sample = [...validStudents].sort(() => Math.random() - 0.5).slice(0, 25);

        const teacherById = new Map(teachersSrc.map((t) => [hex(t._id), t]));
        const schoolById = new Map(schoolsSrc.map((s) => [hex(s._id), s]));
        const districtById = new Map(districtsSrc.map((d) => [hex(d._id), d]));

        let sampleOk = 0;
        for (const s of sample) {
            const mongoId = hex(s._id)!;
            const res = await pg.query(`SELECT * FROM students WHERE legacy_mongo_id = $1`, [mongoId]);
            if (res.rows.length === 0) { mismatch(`student code=${s.code}`, `не найден в Postgres (legacy_mongo_id=${mongoId})`); continue; }
            const pgRow = res.rows[0];
            const problems: string[] = [];

            if (pgRow.code !== String(s.code) && Number(pgRow.code) !== s.code) problems.push(`code: mongo=${s.code} pg=${pgRow.code}`);
            if ((pgRow.last_name ?? null) !== (s.lastName ?? null)) problems.push(`lastName: mongo=${s.lastName} pg=${pgRow.last_name}`);
            if (pgRow.first_name !== s.firstName) problems.push(`firstName: mongo=${s.firstName} pg=${pgRow.first_name}`);
            if ((pgRow.middle_name ?? null) !== (s.middleName ?? null)) problems.push(`middleName: mongo=${s.middleName} pg=${pgRow.middle_name}`);
            if ((pgRow.grade ?? null) !== (s.grade ?? null)) problems.push(`grade: mongo=${s.grade} pg=${pgRow.grade}`);
            if ((pgRow.max_level ?? null) !== (s.maxLevel ?? null)) problems.push(`maxLevel: mongo=${s.maxLevel} pg=${pgRow.max_level}`);
            if ((pgRow.status ?? null) !== (s.status ?? null)) problems.push(`status: mongo=${s.status} pg=${pgRow.status}`);
            if ((pgRow.avatar_url ?? null) !== (s.avatarUrl ?? null)) problems.push(`avatarUrl: mongo=${s.avatarUrl} pg=${pgRow.avatar_url}`);

            const teacherDoc = s.teacher ? teacherById.get(hex(s.teacher)) : null;
            if ((teacherDoc?.code ?? null) !== (pgRow.teacher_id ? Number((await pg.query(`SELECT code FROM teachers WHERE id=$1`, [pgRow.teacher_id])).rows[0]?.code) : null)) {
                problems.push(`teacher code mismatch`);
            }
            const schoolDoc = s.school ? schoolById.get(hex(s.school)) : null;
            if ((schoolDoc?.code ?? null) !== (pgRow.school_id ? Number((await pg.query(`SELECT code FROM schools WHERE id=$1`, [pgRow.school_id])).rows[0]?.code) : null)) {
                problems.push(`school code mismatch`);
            }
            const districtDoc = s.district ? districtById.get(hex(s.district)) : null;
            if ((districtDoc?.code ?? null) !== (pgRow.district_id ? Number((await pg.query(`SELECT code FROM districts WHERE id=$1`, [pgRow.district_id])).rows[0]?.code) : null)) {
                problems.push(`district code mismatch`);
            }

            const mongoResultsCount = resultsSrc.filter((r) => hex(r.student) === mongoId).length;
            const pgResultsCountRes = await pg.query(`SELECT count(*)::int AS c FROM student_results WHERE student_id = $1`, [pgRow.id]);
            if (mongoResultsCount !== pgResultsCountRes.rows[0].c) problems.push(`studentResults count: mongo=${mongoResultsCount} pg=${pgResultsCountRes.rows[0].c}`);

            const mongoRatingYears = new Set((s.ratings ?? []).map((r: any) => r.year));
            const pgRatingsCountRes = await pg.query(`SELECT count(*)::int AS c FROM student_year_ratings WHERE student_id = $1`, [pgRow.id]);
            if (mongoRatingYears.size !== pgRatingsCountRes.rows[0].c) problems.push(`ratings years count: mongo=${mongoRatingYears.size} pg=${pgRatingsCountRes.rows[0].c}`);

            if (problems.length > 0) mismatch(`student code=${s.code} (_id=${mongoId})`, problems.join("; "));
            else sampleOk++;
        }
        if (sampleOk === sample.length) ok(`все ${sample.length} случайных учеников совпали полностью`);

        // ================================================================ 4. NULL там, где не должно
        console.log("\n=== 4. Ссылки: NULL там, где в Mongo была реальная ссылка ===");
        async function checkRefNulls(label: string, mongoDocs: any[], mongoField: string, pgTable: string, pgColumn: string, knownNullMongoIds?: Set<string>) {
            const rows = (await pg.query(`SELECT legacy_mongo_id, ${pgColumn} AS ref FROM ${pgTable}`)).rows;
            const pgByMongoId = new Map(rows.map((r: any) => [r.legacy_mongo_id, r.ref]));
            let bad = 0;
            for (const d of mongoDocs) {
                const mongoId = hex(d._id)!;
                if (knownNullMongoIds?.has(mongoId)) continue;
                const hasRef = !!d[mongoField];
                const pgRef = pgByMongoId.get(mongoId);
                if (hasRef && pgRef == null && pgByMongoId.has(mongoId)) {
                    bad++;
                    if (bad <= 5) console.log(`     ${label}: ${mongoId} (mongo ${mongoField} задан, pg ${pgColumn} = NULL)`);
                }
            }
            if (bad === 0) ok(`${label}.${mongoField} → ${pgColumn}`);
            else mismatch(`${label}.${mongoField} → ${pgColumn}`, `${bad} записей с NULL там, где в Mongo была ссылка`);
        }

        const schoolsWithoutDistrict = new Set(schoolsSrc.filter((s) => !s.district).map((s) => hex(s._id)!));
        const teachersWithoutSchool = new Set(teachersSrc.filter((t) => !t.school).map((t) => hex(t._id)!));

        await checkRefNulls("schools", schoolsSrc, "district", "schools", "district_id");
        await checkRefNulls("teachers", teachersSrc, "school", "teachers", "school_id");
        await checkRefNulls("teachers", teachersSrc, "district", "teachers", "district_id");
        await checkRefNulls("students", validStudents, "teacher", "students", "teacher_id");
        await checkRefNulls("students", validStudents, "school", "students", "school_id");
        await checkRefNulls("students", validStudents, "district", "students", "district_id");
        await checkRefNulls("booklets", bookletsSrc, "exam", "booklets", "exam_id");
        await checkRefNulls("booklets", bookletsSrc, "district", "booklets", "district_id");
        void schoolsWithoutDistrict; void teachersWithoutSchool; // задокументированы в rating-semantics.md/schema.sql, не сюрприз — оставлены для читаемости отчёта

        console.log(`\n${mismatchCount === 0 ? "✅ Расхождений не найдено." : `❌ Найдено расхождений: ${mismatchCount}`}`);
        process.exitCode = mismatchCount === 0 ? 0 : 1;
    } finally {
        await pg.end();
        await mongoClient.close();
    }
}

main();
