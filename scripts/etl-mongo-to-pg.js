"use strict";
/**
 * Перенос данных İSİM из MongoDB в PostgreSQL. Одноразовый скрипт: стратегия
 * "truncate и залить заново" внутри одной транзакции — при любой ошибке откат
 * возвращает Postgres в пустое состояние, повторный прогон детерминирован.
 *
 * Источники правды:
 *   - education-system-back/db/schema.sql        — имена таблиц/столбцов
 *   - education-system-back/db/rating-semantics.md — что переносится "как есть", а что считается views
 *   - PG_MIGRATION_TASKS.md шаг 3                 — задание и таблица соответствий полей
 *
 * Что НЕ переносится (см. schema.sql и PG_MIGRATION_TASKS.md):
 *   - School.districtCode (денормализация, в Postgres джойн)
 *   - плоские рейтинговые поля сущностей (score/averageScore/place/districtPlace
 *     и составляющие) — это views поверх *_year_ratings и student_results
 *
 * Известный гейт (BACKEND_CLEANUP_PLAN.md задача 0, подтверждено на копии 04.08.2026):
 *   2 группы дублей Student.code (4 документа). UNIQUE(code) в Postgres не даст
 *   их вставить. Скрипт исключает все 4 документа из переноса и печатает их
 *   поимённо — это ожидаемое поведение, не сбой. Какой из дублей правильный,
 *   решает заказчик; переносить наугад нельзя.
 *
 * Всё остальное несовпадение (висячая ссылка на несуществующую сущность,
 * неожиданный дубль кода там, где его не было в аудите) — не гейт, а сюрприз:
 * скрипт останавливается исключением, транзакция откатывается.
 *
 * Запуск (внутри docker-сети isim_default, где видны mongo-etl-tmp и isim-pg):
 *   MONGO_URL=mongodb://mongo-etl-tmp:27017/kpm \
 *   PG_URL=postgres://isim:$PG_PASSWORD@isim-pg:5432/isim \
 *   npx ts-node etl-mongo-to-pg.ts
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongodb_1 = require("mongodb");
const pg_1 = require("pg");
const MONGO_URL = process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm";
const PG_URL = process.env.PG_URL;
if (!PG_URL) {
    console.error("PG_URL не задан (postgres://isim:<пароль>@isim-pg:5432/isim)");
    process.exit(1);
}
function hex(id) {
    if (!id)
        return null;
    return id.toHexString ? id.toHexString() : String(id);
}
/** Многострочный INSERT пачками; при needIds возвращает [id, legacy_mongo_id] для построения карты ссылок. */
function insertRows(pg_2, table_1, columns_1, rows_1) {
    return __awaiter(this, arguments, void 0, function* (pg, table, columns, rows, opts = {}) {
        var _a;
        const batchSize = (_a = opts.batchSize) !== null && _a !== void 0 ? _a : 500;
        const out = [];
        for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            const values = [];
            const placeholders = chunk
                .map((row, ri) => {
                const base = ri * columns.length;
                values.push(...row);
                return "(" + columns.map((_, ci) => `$${base + ci + 1}`).join(",") + ")";
            })
                .join(",");
            const returning = opts.needIds ? " RETURNING id, legacy_mongo_id" : "";
            const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}${returning}`;
            const res = yield pg.query(sql, values);
            if (opts.needIds) {
                for (const r of res.rows)
                    out.push({ id: BigInt(r.id), legacy_mongo_id: r.legacy_mongo_id });
            }
        }
        return out;
    });
}
function buildMap(rows) {
    const m = new Map();
    for (const r of rows)
        m.set(r.legacy_mongo_id, r.id);
    return m;
}
/** Резолвит ссылку через карту; кидает исключение на непредвиденной висячей ссылке (это не наш известный гейт). */
function resolveRef(map, refId, context) {
    const h = hex(refId);
    if (h === null)
        return null;
    const resolved = map.get(h);
    if (resolved === undefined) {
        throw new Error(`Висячая ссылка: ${context} → ObjectId(${h}) не найден среди перенесённых записей`);
    }
    return resolved;
}
/** Как resolveRef, но не кидает — используется там, где решение "пропустить всю запись" принимается вызывающим кодом. */
function tryResolveRef(map, refId) {
    const h = hex(refId);
    if (h === null)
        return { ok: true, value: null };
    const resolved = map.get(h);
    if (resolved === undefined)
        return { ok: false };
    return { ok: true, value: resolved };
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
        const mongoClient = new mongodb_1.MongoClient(MONGO_URL);
        yield mongoClient.connect();
        const db = mongoClient.db();
        const pg = new pg_1.Client({ connectionString: PG_URL });
        yield pg.connect();
        const summary = [];
        try {
            yield pg.query("BEGIN");
            yield pg.query(`TRUNCATE TABLE
            user_refresh_tokens, user_settings, grade_promotion_logs, users,
            student_year_ratings, teacher_year_ratings, school_year_ratings, district_year_ratings,
            booklets, student_results, students, exams, teachers, schools, districts
            RESTART IDENTITY CASCADE`);
            // ---------------------------------------------------------------- districts
            const districtsSrc = yield db.collection("districts").find({}).toArray();
            const districtRows = districtsSrc.map((d) => {
                var _a, _b, _c, _d, _e, _f;
                return [
                    d.code, d.name,
                    (_a = d.region) !== null && _a !== void 0 ? _a : null,
                    (_b = d.studentCount) !== null && _b !== void 0 ? _b : null,
                    (_c = d.rate) !== null && _c !== void 0 ? _c : null,
                    (_d = d.districtOfTheYearScore) !== null && _d !== void 0 ? _d : 0,
                    (_e = d.active) !== null && _e !== void 0 ? _e : true,
                    (_f = d.avatarUrl) !== null && _f !== void 0 ? _f : null,
                    hex(d._id),
                ];
            });
            const districtsMap = buildMap(yield insertRows(pg, "districts", ["code", "name", "region", "student_count", "rate", "district_of_the_year_score", "active", "avatar_url", "legacy_mongo_id"], districtRows, { needIds: true }));
            summary.push(`districts: ${districtsMap.size}`);
            // ---------------------------------------------------------------- schools
            // district — обязательное поле и в Mongoose (required:true), и в schema.sql (NOT NULL).
            // Найдено 04.08.2026: 3 школы в проде без district — проверены и подтверждены мусором
            // (districtCode:0, status:"", одинаковое имя "Sabirbad məktəbi" у всех трёх, 0 ссылок
            // от students/users в любом виде). Не переносим, а не ослабляем ограничение ради них.
            const schoolsSrcAll = yield db.collection("schools").find({}).toArray();
            const schoolsWithoutDistrict = schoolsSrcAll.filter((s) => !s.district);
            if (schoolsWithoutDistrict.length > 0) {
                console.warn(`\n⚠️  Школы без district — исключены из переноса (${schoolsWithoutDistrict.length}):`);
                for (const s of schoolsWithoutDistrict)
                    console.warn(`  code=${s.code} "${s.name}" (_id=${hex(s._id)})`);
                console.warn("");
            }
            const schoolsSrc = schoolsSrcAll.filter((s) => !!s.district);
            const schoolRows = schoolsSrc.map((s) => {
                var _a, _b, _c, _d, _e, _f;
                return [
                    s.code, s.name,
                    (_a = s.address) !== null && _a !== void 0 ? _a : null,
                    resolveRef(districtsMap, s.district, `school ${s.code} → district`),
                    (_b = s.studentCount) !== null && _b !== void 0 ? _b : null,
                    (_c = s.status) !== null && _c !== void 0 ? _c : null,
                    (_d = s.schoolOfTheYearScore) !== null && _d !== void 0 ? _d : 0,
                    (_e = s.active) !== null && _e !== void 0 ? _e : true,
                    (_f = s.avatarUrl) !== null && _f !== void 0 ? _f : null,
                    hex(s._id),
                ];
            });
            const schoolsMap = buildMap(yield insertRows(pg, "schools", ["code", "name", "address", "district_id", "student_count", "status", "school_of_the_year_score", "active", "avatar_url", "legacy_mongo_id"], schoolRows, { needIds: true }));
            summary.push(`schools: ${schoolsMap.size}` + (schoolsWithoutDistrict.length ? ` (исключено без district: ${schoolsWithoutDistrict.length})` : ""));
            // ---------------------------------------------------------------- teachers
            const teachersSrc = yield db.collection("teachers").find({}).toArray();
            const teacherRows = teachersSrc.map((t) => {
                var _a, _b, _c, _d, _e;
                return [
                    t.code, t.fullname,
                    resolveRef(schoolsMap, t.school, `teacher ${t.code} → school`),
                    resolveRef(districtsMap, t.district, `teacher ${t.code} → district`),
                    (_a = t.studentCount) !== null && _a !== void 0 ? _a : null,
                    (_b = t.status) !== null && _b !== void 0 ? _b : null,
                    (_c = t.teacherOfTheYearScore) !== null && _c !== void 0 ? _c : 0,
                    (_d = t.active) !== null && _d !== void 0 ? _d : true,
                    (_e = t.avatarUrl) !== null && _e !== void 0 ? _e : null,
                    hex(t._id),
                ];
            });
            const teachersMap = buildMap(yield insertRows(pg, "teachers", ["code", "fullname", "school_id", "district_id", "student_count", "status", "teacher_of_the_year_score", "active", "avatar_url", "legacy_mongo_id"], teacherRows, { needIds: true }));
            summary.push(`teachers: ${teachersMap.size} (без school: ${teachersSrc.filter((t) => !t.school).length})`);
            // ---------------------------------------------------------------- students (дедуп-гейт по code)
            const studentsSrc = yield db.collection("students").find({}).toArray();
            const byCode = new Map();
            for (const s of studentsSrc) {
                if (!byCode.has(s.code))
                    byCode.set(s.code, []);
                byCode.get(s.code).push(s);
            }
            const excludedStudentIds = new Set();
            const dupGroups = [...byCode.entries()].filter(([, docs]) => docs.length > 1);
            if (dupGroups.length > 0) {
                console.warn(`\n⚠️  Дубли Student.code — исключены из переноса (${dupGroups.length} групп, ${dupGroups.reduce((n, [, d]) => n + d.length, 0)} документов):`);
                for (const [code, docs] of dupGroups) {
                    console.warn(`  code=${code}: ` + docs.map((d) => { var _a, _b; return `${(_a = d.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = d.lastName) !== null && _b !== void 0 ? _b : ""} (_id=${hex(d._id)})`.trim(); }).join(", "));
                    for (const d of docs)
                        excludedStudentIds.add(hex(d._id));
                }
                console.warn("  → решение, какой код правильный, за заказчиком (BACKEND_CLEANUP_PLAN.md задача 0).\n");
            }
            const studentsToInsert = studentsSrc.filter((s) => !excludedStudentIds.has(hex(s._id)));
            const studentRows = studentsToInsert.map((s) => {
                var _a, _b, _c, _d, _e, _f;
                return [
                    s.code,
                    (_a = s.lastName) !== null && _a !== void 0 ? _a : null,
                    s.firstName,
                    (_b = s.middleName) !== null && _b !== void 0 ? _b : null,
                    (_c = s.grade) !== null && _c !== void 0 ? _c : null,
                    resolveRef(teachersMap, s.teacher, `student ${s.code} → teacher`),
                    resolveRef(schoolsMap, s.school, `student ${s.code} → school`),
                    resolveRef(districtsMap, s.district, `student ${s.code} → district`),
                    (_d = s.maxLevel) !== null && _d !== void 0 ? _d : null,
                    (_e = s.status) !== null && _e !== void 0 ? _e : null,
                    (_f = s.avatarUrl) !== null && _f !== void 0 ? _f : null,
                    hex(s._id),
                ];
            });
            const studentsMap = buildMap(yield insertRows(pg, "students", ["code", "last_name", "first_name", "middle_name", "grade", "teacher_id", "school_id", "district_id", "max_level", "status", "avatar_url", "legacy_mongo_id"], studentRows, { needIds: true, batchSize: 1000 }));
            summary.push(`students: ${studentsMap.size} (исключено дублей: ${excludedStudentIds.size})`);
            // ---------------------------------------------------------------- exams
            const examsSrc = yield db.collection("exams").find({}).toArray();
            const examRows = examsSrc.map((e) => { var _a; return [e.code, e.name, e.date, (_a = e.active) !== null && _a !== void 0 ? _a : true, hex(e._id)]; });
            const examsMap = buildMap(yield insertRows(pg, "exams", ["code", "name", "date", "active", "legacy_mongo_id"], examRows, { needIds: true }));
            summary.push(`exams: ${examsMap.size}`);
            // ---------------------------------------------------------------- student_results
            const resultsSrc = yield db.collection("studentresults").find({}).toArray();
            let skippedForExcludedStudent = 0;
            const resultRows = [];
            for (const r of resultsSrc) {
                const studentHex = hex(r.student);
                if (studentHex && excludedStudentIds.has(studentHex)) {
                    skippedForExcludedStudent++;
                    continue;
                }
                const disc = (_a = r.disciplines) !== null && _a !== void 0 ? _a : {};
                const qc = (_b = r.questionCounts) !== null && _b !== void 0 ? _b : {};
                resultRows.push([
                    resolveRef(studentsMap, r.student, `studentResult ${hex(r._id)} → student`),
                    resolveRef(examsMap, r.exam, `studentResult ${hex(r._id)} → exam`),
                    r.grade,
                    disc.az, disc.math,
                    (_c = disc.lifeKnowledge) !== null && _c !== void 0 ? _c : null,
                    (_d = disc.logic) !== null && _d !== void 0 ? _d : null,
                    (_e = disc.english) !== null && _e !== void 0 ? _e : null,
                    qc.az, qc.math,
                    (_f = qc.lifeKnowledge) !== null && _f !== void 0 ? _f : null,
                    (_g = qc.logic) !== null && _g !== void 0 ? _g : null,
                    (_h = qc.english) !== null && _h !== void 0 ? _h : null,
                    r.totalScore, r.score, r.level,
                    (_j = r.status) !== null && _j !== void 0 ? _j : null,
                    r.participationScore,
                    (_k = r.developmentScore) !== null && _k !== void 0 ? _k : null,
                    (_l = r.studentOfTheMonthScore) !== null && _l !== void 0 ? _l : null,
                    (_m = r.republicWideStudentOfTheMonthScore) !== null && _m !== void 0 ? _m : null,
                    r.month, r.year, hex(r._id),
                ]);
            }
            yield insertRows(pg, "student_results", ["student_id", "exam_id", "grade", "az", "math", "life_knowledge", "logic", "english",
                "az_count", "math_count", "life_knowledge_count", "logic_count", "english_count",
                "total_score", "score", "level", "status", "participation_score", "development_score",
                "student_of_the_month_score", "republic_wide_student_of_the_month_score", "month", "year", "legacy_mongo_id"], resultRows, { batchSize: 1000 });
            summary.push(`student_results: ${resultRows.length} (пропущено из-за исключённых студентов: ${skippedForExcludedStudent})`);
            // ---------------------------------------------------------------- booklets
            const bookletsSrc = yield db.collection("booklets").find({}).toArray();
            const bookletRows = bookletsSrc.map((b) => {
                var _a, _b;
                return [
                    resolveRef(examsMap, b.exam, `booklet ${hex(b._id)} → exam`),
                    resolveRef(districtsMap, b.district, `booklet ${hex(b._id)} → district`),
                    b.variant, b.grade, JSON.stringify((_a = b.disciplines) !== null && _a !== void 0 ? _a : {}),
                    (_b = b.name) !== null && _b !== void 0 ? _b : null,
                    hex(b._id),
                ];
            });
            yield insertRows(pg, "booklets", ["exam_id", "district_id", "variant", "grade", "disciplines", "name", "legacy_mongo_id"], bookletRows);
            summary.push(`booklets: ${bookletRows.length}`);
            // ---------------------------------------------------------------- users
            // Правило заказчика (04.08.2026): для ролей student/teacher/schoolDirector/districtRepresenter
            // привязка к своей сущности ОБЯЗАТЕЛЬНА — без неё роль ничего не может делать (вся ролевая
            // фильтрация в контроллерах читает именно это поле, см. CLAUDE.md "Role-based data scoping").
            // Если поле не задано вовсе ИЛИ ссылается на удалённую сущность — аккаунт "пустышка", не переносится.
            // superadmin/admin/moderator ничего не обязаны — их лишние ссылки (если есть) просто обнуляются,
            // сам аккаунт не исключается.
            const VALID_ROLES = new Set(["superadmin", "admin", "moderator", "districtRepresenter", "schoolDirector", "teacher", "student"]);
            const ROLE_REQUIRED_FIELD = {
                student: "studentId", teacher: "teacherId", schoolDirector: "schoolId", districtRepresenter: "districtId",
            };
            const usersSrc = yield db.collection("users").find({}).toArray();
            const excludedUsers = [];
            const excludedUserMongoIds = new Set();
            const userRowsPrepared = [];
            for (const u of usersSrc) {
                let role = (_o = u.role) !== null && _o !== void 0 ? _o : "student";
                if (!VALID_ROLES.has(role)) {
                    // Известное исключение (решение заказчика 04.08.2026): единственный аккаунт с role="user"
                    // в проде — kazimi.msu@gmail.com, личный аккаунт заказчика, переносится как admin.
                    if (u.email === "kazimi.msu@gmail.com" && role === "user") {
                        role = "admin";
                    }
                    else {
                        throw new Error(`Неизвестное значение role="${role}" у пользователя ${u.email} — не входит в enum приложения`);
                    }
                }
                const districtR = tryResolveRef(districtsMap, u.districtId);
                const schoolR = tryResolveRef(schoolsMap, u.schoolId);
                const teacherR = tryResolveRef(teachersMap, u.teacherId);
                const studentR = tryResolveRef(studentsMap, u.studentId); // дубль-исключённый студент просто не в studentsMap → ok:false, ниже это и требуется
                const fieldsByName = { districtId: districtR, schoolId: schoolR, teacherId: teacherR, studentId: studentR };
                const requiredField = ROLE_REQUIRED_FIELD[role];
                if (requiredField) {
                    const r = fieldsByName[requiredField];
                    if (!r.ok || r.value == null) {
                        excludedUsers.push({ email: u.email, fields: [requiredField] });
                        excludedUserMongoIds.add(hex(u._id));
                        continue;
                    }
                }
                // Поля, не обязательные для этой роли, если висячие — просто обнуляем, аккаунт не трогаем.
                const safe = (r) => (r.ok ? r.value : null);
                userRowsPrepared.push({
                    mongoId: hex(u._id),
                    row: [
                        u.email, u.passwordHash, role,
                        (_p = u.isApproved) !== null && _p !== void 0 ? _p : false,
                        (_q = u.lastLoginAt) !== null && _q !== void 0 ? _q : null,
                        safe(districtR), safe(schoolR), safe(teacherR), safe(studentR),
                        (_r = u.createdAt) !== null && _r !== void 0 ? _r : new Date(),
                        (_s = u.updatedAt) !== null && _s !== void 0 ? _s : new Date(),
                        hex(u._id),
                    ],
                });
            }
            if (excludedUsers.length > 0) {
                console.warn(`\n⚠️  Пользователи с висячими ссылками — исключены из переноса (${excludedUsers.length}):`);
                for (const eu of excludedUsers)
                    console.warn(`  ${eu.email}: ${eu.fields.join(", ")}`);
                console.warn("");
            }
            const usersMap = buildMap(yield insertRows(pg, "users", ["email", "password_hash", "role", "is_approved", "last_login_at", "district_id", "school_id", "teacher_id", "student_id", "created_at", "updated_at", "legacy_mongo_id"], userRowsPrepared.map((r) => r.row), { needIds: true }));
            summary.push(`users: ${usersMap.size}` + (excludedUsers.length ? ` (исключено из-за висячих ссылок: ${excludedUsers.length})` : ""));
            // ---------------------------------------------------------------- user_refresh_tokens
            // В Mongo у токена нет собственной метки времени — используем createdAt пользователя
            // как единственный доступный источник (это явное упрощение, не оригинальные данные).
            let tokenRows = [];
            for (const u of usersSrc) {
                const userId = usersMap.get(hex(u._id));
                if (userId === undefined)
                    continue; // пользователь исключён выше
                for (const token of (_t = u.refreshTokens) !== null && _t !== void 0 ? _t : []) {
                    tokenRows.push([userId, token, (_u = u.createdAt) !== null && _u !== void 0 ? _u : new Date()]);
                }
            }
            yield insertRows(pg, "user_refresh_tokens", ["user_id", "token", "created_at"], tokenRows);
            summary.push(`user_refresh_tokens: ${tokenRows.length}`);
            // ---------------------------------------------------------------- user_settings
            // userId="global" — осознанный sentinel приложения (userSettings.controller.ts GLOBAL_SETTINGS_ID),
            // не пользовательская запись → user_id = NULL (singleton, см. schema.sql).
            // userId, не найденный ни в usersMap, ни в excludedUserMongoIds, ни "global" — по-настоящему
            // осиротевшая запись (владелец удалён из Mongo независимо от этой миграции, найдено 04.08.2026:
            // 1 запись от 2025-06-16). Пропускаем и печатаем, не бросаем исключение — это лист без зависимых таблиц.
            // Известный баг приложения (найден 04.08.2026, не наш известный гейт): userId в схеме — Mixed,
            // при апдейте иногда сохраняется строкой вместо ObjectId, апсерт по $userId промахивается
            // мимо старой записи и плодит вторую. Дедуп по нормализованному userId, побеждает более
            // свежая по updatedAt (эмпирически — это и есть та, что реально отдаёт живое приложение).
            const settingsSrcRaw = yield db.collection("usersettings").find({}).toArray();
            const settingsByNormId = new Map();
            for (const s of settingsSrcRaw) {
                const h = typeof s.userId === "object" && ((_v = s.userId) === null || _v === void 0 ? void 0 : _v.toHexString) ? s.userId.toHexString() : String(s.userId);
                if (!settingsByNormId.has(h))
                    settingsByNormId.set(h, []);
                settingsByNormId.get(h).push(s);
            }
            const settingsSrc = [];
            for (const [, docs] of settingsByNormId) {
                if (docs.length === 1) {
                    settingsSrc.push(docs[0]);
                    continue;
                }
                const sorted = [...docs].sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = b.updatedAt) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = a.updatedAt) === null || _c === void 0 ? void 0 : _c.getTime()) !== null && _d !== void 0 ? _d : 0); });
                console.warn(`⚠️  usersettings: дубль userId, оставлена запись ${hex(sorted[0]._id)} (updatedAt=${sorted[0].updatedAt}), отброшены: ${sorted.slice(1).map((d) => hex(d._id)).join(", ")}`);
                settingsSrc.push(sorted[0]);
            }
            let settingsSkippedForExcludedUser = 0;
            const settingsOrphaned = [];
            const settingsRows = [];
            for (const s of settingsSrc) {
                const userIdHex = typeof s.userId === "object" && ((_w = s.userId) === null || _w === void 0 ? void 0 : _w.toHexString) ? s.userId.toHexString() : String(s.userId);
                let userId;
                if (userIdHex === "global") {
                    userId = null;
                }
                else if (excludedUserMongoIds.has(userIdHex)) {
                    settingsSkippedForExcludedUser++;
                    continue;
                }
                else {
                    const resolved = usersMap.get(userIdHex);
                    if (resolved === undefined) {
                        settingsOrphaned.push({ mongoId: hex(s._id), userIdHex });
                        continue;
                    }
                    userId = resolved;
                }
                settingsRows.push([
                    userId,
                    (_x = s.developingStudentCollumns) !== null && _x !== void 0 ? _x : [],
                    (_y = s.studentCollumns) !== null && _y !== void 0 ? _y : [],
                    (_z = s.allStudentCollumns) !== null && _z !== void 0 ? _z : [],
                    (_0 = s.allTeacherCollumns) !== null && _0 !== void 0 ? _0 : [],
                    (_1 = s.allSchoolCollumns) !== null && _1 !== void 0 ? _1 : [],
                    (_2 = s.allDistrictCollumns) !== null && _2 !== void 0 ? _2 : [],
                    (_3 = s.teacherViewCollumns) !== null && _3 !== void 0 ? _3 : [],
                    (_4 = s.directorViewCollumns) !== null && _4 !== void 0 ? _4 : [],
                    (_5 = s.districtViewCollumns) !== null && _5 !== void 0 ? _5 : [],
                    (_6 = s.studentViewCollumns) !== null && _6 !== void 0 ? _6 : [],
                    JSON.stringify((_7 = s.roleSettings) !== null && _7 !== void 0 ? _7 : {}),
                    (_8 = s.createdAt) !== null && _8 !== void 0 ? _8 : new Date(),
                    (_9 = s.updatedAt) !== null && _9 !== void 0 ? _9 : new Date(),
                ]);
            }
            if (settingsOrphaned.length > 0) {
                console.warn(`\n⚠️  userSettings без существующего владельца — пропущены (${settingsOrphaned.length}):`);
                for (const so of settingsOrphaned)
                    console.warn(`  usersettings._id=${so.mongoId} → user ${so.userIdHex} не существует`);
                console.warn("");
            }
            yield insertRows(pg, "user_settings", ["user_id", "developing_student_collumns", "student_collumns", "all_student_collumns", "all_teacher_collumns",
                "all_school_collumns", "all_district_collumns", "teacher_view_collumns", "director_view_collumns",
                "district_view_collumns", "student_view_collumns", "role_settings", "created_at", "updated_at"], settingsRows);
            summary.push(`user_settings: ${settingsRows.length}`
                + (settingsSkippedForExcludedUser ? ` (пропущено для исключённых пользователей: ${settingsSkippedForExcludedUser})` : "")
                + (settingsOrphaned.length ? ` (осиротевших пропущено: ${settingsOrphaned.length})` : ""));
            // ---------------------------------------------------------------- grade_promotion_logs
            const logsSrc = yield db.collection("gradepromotionlogs").find({}).toArray();
            const logRows = logsSrc.map((l) => {
                var _a, _b, _c;
                return [
                    l.academicYear, l.status,
                    (_a = l.promotedCount) !== null && _a !== void 0 ? _a : null,
                    (_b = l.ceilingCount) !== null && _b !== void 0 ? _b : null,
                    resolveRef(usersMap, l.executedBy, `gradePromotionLog ${hex(l._id)} → executedBy`),
                    l.executedAt,
                    (_c = l.completedAt) !== null && _c !== void 0 ? _c : null,
                    hex(l._id),
                ];
            });
            yield insertRows(pg, "grade_promotion_logs", ["academic_year", "status", "promoted_count", "ceiling_count", "executed_by", "executed_at", "completed_at", "legacy_mongo_id"], logRows);
            summary.push(`grade_promotion_logs: ${logRows.length}`);
            // ---------------------------------------------------------------- *_year_ratings
            function loadYearRatings(collection, table, fkColumn, idMap, hasDistrictPlace, excluded) {
                return __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c, _d, _e;
                    const docs = yield db.collection(collection).find({}).toArray();
                    const rows = [];
                    let skipped = 0;
                    for (const d of docs) {
                        const h = hex(d._id);
                        if (excluded === null || excluded === void 0 ? void 0 : excluded.has(h)) {
                            skipped++;
                            continue;
                        }
                        const entityId = idMap.get(h);
                        if (entityId === undefined)
                            continue; // сущность не перенесена (не должно происходить вне known-гейта)
                        const seenYears = new Set();
                        for (const r of ((_a = d.ratings) !== null && _a !== void 0 ? _a : []).slice().reverse()) {
                            // reverse: при дублирующемся годе в массиве (не должно быть) оставляем последнюю запись как источник правды
                            if (seenYears.has(r.year))
                                continue;
                            seenYears.add(r.year);
                            const row = [entityId, r.year, (_b = r.score) !== null && _b !== void 0 ? _b : null, (_c = r.averageScore) !== null && _c !== void 0 ? _c : null, (_d = r.place) !== null && _d !== void 0 ? _d : null];
                            if (hasDistrictPlace)
                                row.push((_e = r.districtPlace) !== null && _e !== void 0 ? _e : null);
                            rows.push(row);
                        }
                    }
                    const columns = hasDistrictPlace
                        ? [fkColumn, "year", "score", "average_score", "place", "district_place"]
                        : [fkColumn, "year", "score", "average_score", "place"];
                    yield insertRows(pg, table, columns, rows);
                    summary.push(`${table}: ${rows.length}` + (skipped ? ` (пропущено для исключённых студентов: ${skipped})` : ""));
                });
            }
            yield loadYearRatings("districts", "district_year_ratings", "district_id", districtsMap, false);
            yield loadYearRatings("schools", "school_year_ratings", "school_id", schoolsMap, true);
            yield loadYearRatings("teachers", "teacher_year_ratings", "teacher_id", teachersMap, true);
            yield loadYearRatings("students", "student_year_ratings", "student_id", studentsMap, true, excludedStudentIds);
            yield pg.query("COMMIT");
            console.log("\n✅ ETL завершён, транзакция зафиксирована.\n");
            console.log(summary.join("\n"));
        }
        catch (e) {
            yield pg.query("ROLLBACK");
            console.error("\n❌ ETL прерван, транзакция откачена целиком (Postgres остался пустым):");
            console.error(e);
            process.exitCode = 1;
        }
        finally {
            yield pg.end();
            yield mongoClient.close();
        }
    });
}
main();
