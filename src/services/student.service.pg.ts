import { sql, ExpressionBuilder, Expression } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";
import { CODE_DIVISORS } from "../utils/entity-codes.const";
import { getCurrentAcademicYear } from "../utils/academic-year.util";
import { resolveRatingYear } from "./ratingYear.service.pg";

export interface YearRatingRow {
    year: number;
    score: number | null;
    averageScore: number | null;
    place: number | null;
    districtPlace: number | null;
}

export interface EntitySummary {
    id: number;
    code: number;
    name: string;
}

export interface TeacherSummary {
    id: number;
    code: number;
    fullname: string;
}

export interface Student {
    id: number;
    code: number;
    lastName: string | null;
    firstName: string;
    middleName: string | null;
    grade: number | null;
    teacherId: number | null;
    schoolId: number | null;
    districtId: number | null;
    teacher: TeacherSummary | null;
    school: EntitySummary | null;
    district: EntitySummary | null;
    maxLevel: number | null;
    status: string | null;
    avatarUrl: string | null;
    score: number | null;
    averageScore: number | null;
    place: number | null;
    districtPlace: number | null;
    filterPlace: number | null;
    participationCount: number;
    ratings: YearRatingRow[];
    /** Класс ученика в ЗАПРОШЕННОМ учебном году (см. student_grade_history). null = за тот год
     *  класс неизвестен. `grade` рядом остаётся живым классом из реестра — их нельзя путать. */
    yearGrade: number | null;
}

export interface StudentCreate {
    code: number;
    lastName?: string | null;
    firstName: string;
    middleName?: string | null;
    grade?: number | null;
    teacherId?: number | null;
    schoolId?: number | null;
    districtId?: number | null;
    maxLevel?: number;
    status?: string;
}

export interface ExamSummary {
    id: number;
    code: number;
    name: string;
    date: Date;
}

export interface StudentResultRow {
    id: number;
    examId: number | null;
    exam: ExamSummary | null;
    grade: number;
    az: number; math: number; lifeKnowledge: number | null; logic: number | null; english: number | null;
    azCount: number; mathCount: number; lifeKnowledgeCount: number | null; logicCount: number | null; englishCount: number | null;
    // Вложенные disciplines/questionCounts — фронтенд (ExamResult) читает именно их, не плоские
    // поля выше (те оставлены для обратной совместимости с другими потребителями). Отсутствующий
    // предмет (NULL в БД) не попадает в объект вовсе — .az !== undefined в шаблоне так и ждёт.
    disciplines: { az?: number; math?: number; lifeKnowledge?: number; logic?: number; english?: number };
    questionCounts: { az?: number; math?: number; lifeKnowledge?: number; logic?: number; english?: number };
    totalScore: number; score: number; level: string; status: string | null;
    participationScore: number; developmentScore: number | null;
    studentOfTheMonthScore: number | null; republicWideStudentOfTheMonthScore: number | null;
    month: number; year: number;
    /** Учебный год результата — generated-колонка student_results.academic_year (сентябрь-декабрь
     *  → year, январь-июнь → year - 1, июль-август → null). Отдавать её обязательно: `year` — это
     *  КАЛЕНДАРНЫЙ год, и фронт, вычисляя учебный год из него сам, ошибался на весенних месяцах. */
    academicYear: number | null;
}

type StudentRow = {
    id: number; code: number; last_name: string | null; first_name: string; middle_name: string | null;
    grade: number | null; teacher_id: number | null; school_id: number | null; district_id: number | null;
    max_level: number | null; status: string | null; avatar_url: string | null;
};

/**
 * Postgres-версия StudentService. См. district/school/teacher.service.pg.ts для общих решений.
 *
 * Экспортированные в Mongo-версии хелперы deleteStudentsBySchoolId/BySchoolsIds/ByDistrictId
 * и buildExamFilter не перенесены — проверено (04.08.2026), нигде за пределами
 * student.service.ts не вызывались, мёртвый код. deleteStudentsByTeacherId/ByTeachersIds тоже
 * не перенесены — их звал только старый teacher.service.ts, а он уже заменён (каскад теперь
 * внутри teacher.service.pg.ts). getResultsByStudentId/deleteByStudentId (studentResult.service.ts,
 * ещё на Mongo) не задействуются — здесь свои, минимальные, через student_results напрямую:
 * полный перенос studentResult.service.ts — отдельная, более крупная задача вместе со stats.service.ts.
 */
export class StudentServicePg {
    async findById(id: number): Promise<Student | null> {
        const row = await pg.selectFrom("students").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async findByCode(code: number): Promise<Student | null> {
        const row = await pg.selectFrom("students").selectAll().where("code", "=", code).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async getResultsByStudentId(studentId: number): Promise<StudentResultRow[]> {
        const rows = await pg
            .selectFrom("student_results as sr")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            .selectAll("sr")
            .select(["e.id as exam_id_full", "e.code as exam_code", "e.name as exam_name", "e.date as exam_date"])
            .where("sr.student_id", "=", studentId)
            .orderBy("sr.year", "desc")
            .orderBy("sr.month", "desc")
            .execute();

        const sparse = (az: number | null, math: number | null, lifeKnowledge: number | null, logic: number | null, english: number | null) => {
            const obj: { az?: number; math?: number; lifeKnowledge?: number; logic?: number; english?: number } = {};
            if (az !== null) obj.az = az;
            if (math !== null) obj.math = math;
            if (lifeKnowledge !== null) obj.lifeKnowledge = lifeKnowledge;
            if (logic !== null) obj.logic = logic;
            if (english !== null) obj.english = english;
            return obj;
        };

        return rows.map((r) => ({
            id: r.id, examId: r.exam_id,
            exam: r.exam_id_full ? { id: r.exam_id_full, code: r.exam_code!, name: r.exam_name!, date: r.exam_date! } : null,
            grade: r.grade,
            az: r.az, math: r.math, lifeKnowledge: r.life_knowledge, logic: r.logic, english: r.english,
            azCount: r.az_count, mathCount: r.math_count, lifeKnowledgeCount: r.life_knowledge_count,
            logicCount: r.logic_count, englishCount: r.english_count,
            disciplines: sparse(r.az, r.math, r.life_knowledge, r.logic, r.english),
            questionCounts: sparse(r.az_count, r.math_count, r.life_knowledge_count, r.logic_count, r.english_count),
            totalScore: r.total_score, score: r.score, level: r.level, status: r.status,
            participationScore: r.participation_score, developmentScore: r.development_score,
            studentOfTheMonthScore: r.student_of_the_month_score,
            republicWideStudentOfTheMonthScore: r.republic_wide_student_of_the_month_score,
            month: r.month, year: r.year, academicYear: r.academic_year,
        }));
    }

    /** Резолвит teacher/school/district по коду ученика — арифметика вместо трёх последовательных Mongo find. */
    async assignTeacherToStudent(studentCode: number): Promise<{ teacherId: number | null; schoolId: number | null; districtId: number | null }> {
        const teacherCode = Math.floor(studentCode / CODE_DIVISORS.STUDENT_TO_TEACHER);
        const teacher = await pg.selectFrom("teachers").select(["id", "school_id", "district_id"]).where("code", "=", teacherCode).executeTakeFirst();
        if (!teacher) return { teacherId: null, schoolId: null, districtId: null };
        return { teacherId: teacher.id, schoolId: teacher.school_id, districtId: teacher.district_id };
    }

    async create(data: StudentCreate): Promise<Student> {
        let { teacherId, schoolId, districtId } = data;
        if (teacherId === undefined) {
            const resolved = await this.assignTeacherToStudent(data.code);
            teacherId = resolved.teacherId ?? undefined;
            schoolId = schoolId ?? resolved.schoolId ?? undefined;
            districtId = districtId ?? resolved.districtId ?? undefined;
        }

        const row = await pg
            .insertInto("students")
            .values({
                code: data.code, last_name: data.lastName ?? null, first_name: data.firstName,
                middle_name: data.middleName ?? null, grade: data.grade ?? null,
                teacher_id: teacherId ?? null, school_id: schoolId ?? null, district_id: districtId ?? null,
                max_level: data.maxLevel ?? null, status: data.status ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return (await this.attachExtras([row]))[0];
    }

    async update(id: number, data: Partial<StudentCreate>): Promise<Student> {
        const row = await pg
            .updateTable("students")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.lastName !== undefined && { last_name: data.lastName }),
                ...(data.firstName !== undefined && { first_name: data.firstName }),
                ...(data.middleName !== undefined && { middle_name: data.middleName }),
                ...(data.grade !== undefined && { grade: data.grade }),
                ...(data.teacherId !== undefined && { teacher_id: data.teacherId }),
                ...(data.schoolId !== undefined && { school_id: data.schoolId }),
                ...(data.districtId !== undefined && { district_id: data.districtId }),
                ...(data.maxLevel !== undefined && { max_level: data.maxLevel }),
                ...(data.status !== undefined && { status: data.status }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Student not found");
        return (await this.attachExtras([row]))[0];
    }

    /** Удаляет ученика вместе с его результатами — одна транзакция (вместо двух вызовов сервисов в Mongo-версии). */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            await trx.deleteFrom("student_results").where("student_id", "=", id).execute();
            const result = await trx.deleteFrom("students").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("Student not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        const result = await pg.transaction().execute(async (trx) => {
            await trx.deleteFrom("student_results").where("student_id", "in", ids).execute();
            return await trx.deleteFrom("students").where("id", "in", ids).executeTakeFirst();
        });
        return { insertedCount: 0, modifiedCount: 0, deletedCount: Number(result.numDeletedRows), errors: [] };
    }

    /** Поиск по имени (частями, через все слова) или по коду — см. buildFilter для точной семантики. */
    async search(searchString: string): Promise<Student[]> {
        let query = pg.selectFrom("students").selectAll();
        query = this.applyTextSearch(query, searchString.trim());
        const rows = await query.limit(50).execute();
        return await this.attachExtras(rows);
    }

    async getFilteredStudents(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Student[]; totalCount: number }> {
        const currentYear = filters.academicYear ?? getCurrentAcademicYear();
        const isCurrentYear = currentYear === getCurrentAcademicYear();

        // Год явных БАЛЛОВ (student_year_ratings), отдельный от currentYear (года КЛАССА, см.
        // yearGradeExpr ниже) — REYTINQ_ILI_TASK.md §5. Явный filters.academicYear (/stats)
        // побеждает резолвер и тут, и там, оба совпадают — резолвер вступает только когда год
        // не выбран (реестр учеников): тогда балл берётся за последний год, за который рейтинги
        // реально есть, а класс — за живой текущий (иначе повторили бы баг из
        // SINIF_TARIXCESI_TASK.md — класс "уезжал" бы в прошлый год вместе с баллом).
        const ratingYear = filters.academicYear ?? (await resolveRatingYear());

        // Класс ученика ЗА ВЫБРАННЫЙ ГОД — единственное выражение, используемое везде ниже без
        // вариаций (filterPlace, отбор по фильтру класса, сортировка, колонка в ответе).
        // Правило простое: ТЕКУЩИЙ год — это живой students.grade (реестр и есть истина, пока год
        // идёт: ученика могли завести или поправить ему класс вчера, а student_grade_history за
        // текущий год обновляется только на повышении). ПРОШЛЫЙ год — только история; живой класс
        // там — ровно то враньё задним числом, из-за которого заведена задача
        // (SINIF_TARIXCESI_TASK.md). Отсутствие строки в истории за прошлый год показываем как
        // "нет данных", а не как правдоподобное, но неверное число.
        const yearGradeExpr = isCurrentYear
            ? sql<number | null>`students.grade`
            : sql<number | null>`sgh.grade`;

        // filterPlace: dense rank by score within the current filter scope (region/district/school/
        // teacher/grade), excluding code/search — text search must not reshuffle rankings — partitioned
        // by grade, matching the old Mongo-version buildScorePlaceMap. A joined derived table instead of
        // a second JS ranking pass, same technique already used for participation_count below.
        const rankFilterOptions = { ...filters, code: undefined, search: undefined };
        const filterPlaceSubquery = this.applyFilter(
            pg.selectFrom("students")
                // Балл — за ratingYear (не currentYear): "место в рамках фильтра" ранжирует
                // по баллу того года, что реально показан на карточке/в колонке, а не по баллу
                // текущего года, где может не быть ни одного результата.
                .leftJoin("student_year_ratings", (join) =>
                    join.onRef("student_year_ratings.student_id", "=", "students.id").on("student_year_ratings.year", "=", ratingYear)
                )
                .leftJoin("student_grade_history as sgh", (join) =>
                    join.onRef("sgh.student_id", "=", "students.id").on("sgh.academic_year", "=", currentYear)
                ),
            rankFilterOptions,
            yearGradeExpr
        ).select([
            "students.id as student_id",
            // "место в рамках фильтра" считается внутри того класса, который показан в строке
            // (year_grade), а не живого students.grade — иначе после повышения место "уезжает"
            // в чужой класс вместе со строкой.
            sql<number>`DENSE_RANK() OVER (PARTITION BY coalesce(${yearGradeExpr}, 0) ORDER BY coalesce(student_year_ratings.score, 0) DESC)`.as("filter_place"),
        ]);

        // participationCount — теперь просто COUNT по academic_year (generated column), без ручного $or по месяцам.
        let base = pg
            .selectFrom("students")
            // Балл — за ratingYear, класс (ниже, sgh) — за currentYear. Разные годы намеренно:
            // REYTINQ_ILI_TASK.md §5.
            .leftJoin("student_year_ratings", (join) =>
                join.onRef("student_year_ratings.student_id", "=", "students.id").on("student_year_ratings.year", "=", ratingYear)
            )
            .leftJoin("student_grade_history as sgh", (join) =>
                join.onRef("sgh.student_id", "=", "students.id").on("sgh.academic_year", "=", currentYear)
            )
            .leftJoin(
                pg.selectFrom("student_results")
                    .select(["student_id", ({ fn }) => fn.countAll().as("participation_count")])
                    .where("academic_year", "=", currentYear)
                    .groupBy("student_id")
                    .as("participation"),
                (join) => join.onRef("participation.student_id", "=", "students.id")
            )
            .leftJoin(filterPlaceSubquery.as("fp"), (join) => join.onRef("fp.student_id", "=", "students.id"))
            // Only for the "teacher"/"school"/"district" sort below — attachExtras() fetches the
            // actual teacher/school/district data separately, these joins aren't selected from.
            .leftJoin("teachers as t", "t.id", "students.teacher_id")
            .leftJoin("schools as sc", "sc.id", "students.school_id")
            .leftJoin("districts as d", "d.id", "students.district_id")
            .selectAll("students")
            .select([
                "student_year_ratings.score as current_score",
                "student_year_ratings.average_score as current_average_score",
                "student_year_ratings.place as current_place",
                "student_year_ratings.district_place as current_district_place",
                sql<number>`coalesce(participation.participation_count, 0)`.as("participation_count"),
                "fp.filter_place as filter_place",
                yearGradeExpr.as("year_grade"),
            ]);
        base = this.applyFilter(base, filters, yearGradeExpr);

        // "teacher"/"school"/"district" are the literal sortColumn keys students-year-tab sends
        // (TableColumn.key there, e.g. teacher's field is 'teacher.fullname' but the sort key is
        // just 'teacher') — checked against the raw value, since mapSortColumn has no entries for them.
        const joinedNameSortColumns: Record<string, any> = {
            teacher: sql`t.fullname COLLATE az_ci`,
            school: sql`sc.name COLLATE az_ci`,
            district: sql`d.name COLLATE az_ci`,
        };
        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const azCollatedColumns: Record<string, any> = {
            first_name: sql`students.first_name COLLATE az_ci`,
            last_name: sql`students.last_name COLLATE az_ci`,
            middle_name: sql`students.middle_name COLLATE az_ci`,
        };
        const orderExpr = joinedNameSortColumns[sort.sortColumn] ?? (needsRatingJoin
            ? sql.ref(column)
            : azCollatedColumns[column] ?? sql.ref(`students.${column}`));
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST явно: ученики без строки в student_year_ratings (LEFT JOIN) иначе всплывают
        // в начало при DESC — Postgres по умолчанию сортирует NULL как "больше всех" значений.
        const query = base.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            query.execute(),
            this.applyFilter(
                // Join нужен только затем, чтобы applyFilter мог фильтровать по тому же
                // "классу за год" (grades), что и основной запрос — иначе count разойдётся с
                // фактическим числом строк на странице.
                pg.selectFrom("students")
                    .leftJoin("student_grade_history as sgh", (join) =>
                        join.onRef("sgh.student_id", "=", "students.id").on("sgh.academic_year", "=", currentYear)
                    ),
                filters,
                yearGradeExpr
            )
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        const data = await this.attachExtras(rows);
        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Реальная функция (school_id/teacher_id/district_id ученика все nullable и в Postgres).
     */
    async repairStudentAssignments(): Promise<{
        repairedStudents: number[];
        failedStudents: Array<{ code: number; reason: string }>;
        missedDistricts: number[];
        missedSchools: number[];
        missedTeachers: number[];
    }> {
        const students = await pg.selectFrom("students").selectAll()
            .where(({ eb, or }) => or([eb("teacher_id", "is", null), eb("school_id", "is", null), eb("district_id", "is", null)]))
            .execute();

        const repairedStudents: number[] = [];
        const failedStudents: Array<{ code: number; reason: string }> = [];
        const missedDistricts: number[] = [];
        const missedSchools: number[] = [];
        const missedTeachers: number[] = [];

        const [allTeachers, allSchools, allDistricts] = await Promise.all([
            pg.selectFrom("teachers").select(["id", "code"]).execute(),
            pg.selectFrom("schools").select(["id", "code"]).execute(),
            pg.selectFrom("districts").select(["id", "code"]).execute(),
        ]);
        const teacherByCode = new Map(allTeachers.map((t) => [t.code, t.id]));
        const schoolByCode = new Map(allSchools.map((s) => [s.code, s.id]));
        const districtByCode = new Map(allDistricts.map((d) => [d.code, d.id]));

        for (const student of students) {
            try {
                const teacherCode = Math.floor(student.code / CODE_DIVISORS.STUDENT_TO_TEACHER);
                const schoolCode = Math.floor(student.code / CODE_DIVISORS.STUDENT_TO_SCHOOL);
                const districtCode = Math.floor(student.code / CODE_DIVISORS.STUDENT_TO_DISTRICT);
                const patch: { teacher_id?: number; school_id?: number; district_id?: number } = {};

                if (student.teacher_id === null) {
                    const id = teacherByCode.get(teacherCode);
                    if (id !== undefined) patch.teacher_id = id; else missedTeachers.push(student.code);
                }
                if (student.school_id === null) {
                    const id = schoolByCode.get(schoolCode);
                    if (id !== undefined) patch.school_id = id; else missedSchools.push(student.code);
                }
                if (student.district_id === null) {
                    const id = districtByCode.get(districtCode);
                    if (id !== undefined) patch.district_id = id; else missedDistricts.push(student.code);
                }

                if (Object.keys(patch).length > 0) {
                    await pg.updateTable("students").set(patch).where("id", "=", student.id).execute();
                    repairedStudents.push(student.code);
                }
            } catch (error) {
                failedStudents.push({ code: student.code, reason: error instanceof Error ? error.message : "Unknown" });
            }
        }

        return { repairedStudents, failedStudents, missedDistricts, missedSchools, missedTeachers };
    }

    /** Одноразовый импорт исторических данных 2024 года — см. LEGACY_IMPORT_PLAN.md. */
    async importLegacyStudents(records: any[]): Promise<{ inserted: number; updated: number; skipped: number; errors: number; details: { skippedCodes: number[]; errorMessages: string[] } }> {
        const LEGACY_YEAR = 2024;
        let inserted = 0, updated = 0, skipped = 0, errors = 0;
        const skippedCodes: number[] = [];
        const errorMessages: string[] = [];

        for (const record of records) {
            try {
                const code = Number(record.code);
                if (!code || isNaN(code)) {
                    errors++;
                    errorMessages.push(`Record skipped: missing or invalid code (${JSON.stringify(record.code)})`);
                    continue;
                }

                const existing = await pg.selectFrom("students").select("id").where("code", "=", code).executeTakeFirst();
                if (existing) {
                    const has2024 = await pg.selectFrom("student_year_ratings").select("year").where("student_id", "=", existing.id).where("year", "=", LEGACY_YEAR).executeTakeFirst();
                    if (has2024) {
                        skipped++;
                        skippedCodes.push(code);
                        continue;
                    }
                    const score = typeof record.score === "number" ? record.score : 0;
                    const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;
                    await pg.insertInto("student_year_ratings").values({ student_id: existing.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                    updated++;
                    continue;
                }

                const districtCode = Math.floor(code / CODE_DIVISORS.STUDENT_TO_DISTRICT);
                const schoolCode = Math.floor(code / CODE_DIVISORS.STUDENT_TO_SCHOOL);
                const teacherCode = Math.floor(code / CODE_DIVISORS.STUDENT_TO_TEACHER);

                const [districtRow, schoolRow, teacherRow] = await Promise.all([
                    pg.selectFrom("districts").select("id").where("code", "=", districtCode).executeTakeFirst(),
                    pg.selectFrom("schools").select("id").where("code", "=", schoolCode).executeTakeFirst(),
                    pg.selectFrom("teachers").select("id").where("code", "=", teacherCode).executeTakeFirst(),
                ]);

                const score = typeof record.score === "number" ? record.score : 0;
                const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;

                const created = await pg
                    .insertInto("students")
                    .values({
                        code, first_name: record.firstName || "", last_name: record.lastName || "", middle_name: record.middleName || "",
                        grade: typeof record.grade === "number" ? record.grade : null,
                        district_id: districtRow?.id ?? null, school_id: schoolRow?.id ?? null, teacher_id: teacherRow?.id ?? null,
                    })
                    .returning("id")
                    .executeTakeFirstOrThrow();
                await pg.insertInto("student_year_ratings").values({ student_id: created.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`Student code ${record.code}: ${err.message}`);
            }
        }

        return { inserted, updated, skipped, errors, details: { skippedCodes, errorMessages } };
    }

    private applyTextSearch<Q extends { where: any }>(query: Q, searchTrim: string): Q {
        if (/^\d+$/.test(searchTrim)) {
            const code = parseInt(searchTrim, 10);
            const { start, end } = RequestParser.parseCodeRange(code, 10);
            return query.where("code" as any, ">=", parseInt(start)).where("code" as any, "<=", parseInt(end));
        }

        const terms = searchTrim.split(/\s+/).map(escapeRegex);
        let q = query;
        for (const term of terms) {
            q = q.where((eb: ExpressionBuilder<DB, "students">) =>
                eb.or([
                    eb("first_name", "ilike", `%${term}%`),
                    eb("last_name", "ilike", `%${term}%`),
                    eb("middle_name", "ilike", `%${term}%`),
                ])
            ) as Q;
        }
        return q;
    }

    // gradeExpr — выражение "класс ученика за выбранный год" (см. getFilteredStudents:
    // yearGradeExpr). Все три места, откуда сейчас зовётся applyFilter, добавляют join на
    // student_grade_history и передают его явно; дефолт на живой students.grade — только
    // подстраховка на случай нового вызова без join (сегодня такого нет).
    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg, gradeExpr: Expression<number | null> = sql.ref("students.grade")): Q {
        let q = query;
        // Приоритет как в Mongo-версии: teacherIds > schoolIds > districtIds — только самый специфичный.
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            q = q.where("students.teacher_id" as any, "in", filters.teacherIds);
        } else if (filters.schoolIds && filters.schoolIds.length > 0) {
            q = q.where("students.school_id" as any, "in", filters.schoolIds);
        } else if (filters.districtIds && filters.districtIds.length > 0) {
            q = q.where("students.district_id" as any, "in", filters.districtIds);
        }

        if (filters.grades && filters.grades.length > 0) {
            // Фильтр — по классу ЗА ВЫБРАННЫЙ ГОД (gradeExpr), не по живому students.grade.
            // Побочный эффект, задуманный: при выборе прошлого года + фильтра по классу ученики,
            // у которых класс за тот год неизвестен (нет строки в student_grade_history),
            // из выдачи выпадают — показать их в произвольном классе было бы хуже.
            q = q.where(gradeExpr, "in", filters.grades);
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 10);
            q = q.where("students.code" as any, ">=", parseInt(start)).where("students.code" as any, "<=", parseInt(end));
        }

        if (filters.search) {
            const searchTrim = filters.search.trim();
            if (/^\d+$/.test(searchTrim)) {
                const code = parseInt(searchTrim, 10);
                const { start, end } = RequestParser.parseCodeRange(code, 10);
                q = q.where("students.code" as any, ">=", parseInt(start)).where("students.code" as any, "<=", parseInt(end));
            } else {
                const terms = searchTrim.split(/\s+/).map(escapeRegex);
                for (const term of terms) {
                    q = q.where((eb: any) =>
                        eb.or([
                            eb("students.first_name", "ilike", `%${term}%`),
                            eb("students.last_name", "ilike", `%${term}%`),
                            eb("students.middle_name", "ilike", `%${term}%`),
                        ])
                    ) as Q;
                }
            }
        }

        return q;
    }

    private mapSortColumn(column: string): { column: string; needsRatingJoin: boolean } {
        if (column === "score") return { column: "current_score", needsRatingJoin: true };
        if (column === "averageScore") return { column: "current_average_score", needsRatingJoin: true };
        if (column === "place") return { column: "current_place", needsRatingJoin: true };
        if (column === "districtPlace") return { column: "current_district_place", needsRatingJoin: true };
        // participation_count is a bare SELECT alias (coalesce(participation.participation_count, 0)),
        // not a students table column — needs the same unprefixed sql.ref as current_score/current_place.
        if (column === "participationCount") return { column: "participation_count", needsRatingJoin: true };
        // Same for filter_place — a DENSE_RANK() window function result joined in from a derived table.
        if (column === "filterPlace") return { column: "filter_place", needsRatingJoin: true };
        // grade — сортировка по классу ЗА ВЫБРАННЫЙ ГОД (year_grade, алиас select-а в base), а не
        // по живому students.grade: иначе после повышения сортировка расходится с показанным столбцом.
        if (column === "grade") return { column: "year_grade", needsRatingJoin: true };
        const map: Record<string, string> = {
            code: "code", firstName: "first_name", lastName: "last_name", middleName: "middle_name",
            status: "status",
        };
        return { column: map[column] ?? "last_name", needsRatingJoin: false };
    }

    private async attachExtras(rows: (StudentRow & Partial<{ current_score: number | null; current_average_score: number | null; current_place: number | null; current_district_place: number | null; participation_count: number; filter_place: number | null; year_grade: number | null }>)[]): Promise<Student[]> {
        if (rows.length === 0) return [];
        const studentIds = rows.map((r) => r.id);
        const teacherIds = [...new Set(rows.map((r) => r.teacher_id).filter((id): id is number => id !== null))];
        const schoolIds = [...new Set(rows.map((r) => r.school_id).filter((id): id is number => id !== null))];
        const districtIds = [...new Set(rows.map((r) => r.district_id).filter((id): id is number => id !== null))];
        const currentYear = getCurrentAcademicYear();
        // Только для одиночных путей (getById/findByCode/search, см. комментарий ниже) — там
        // строки приходят без current_score из SQL, и "current" нужно искать по резолверу, а не
        // по currentYear (REYTINQ_ILI_TASK.md §5). Для списочного пути (getFilteredStudents)
        // это не читается вовсе: row.current_score уже посчитан там правильно (за ratingYear
        // с учётом filters.academicYear) и имеет приоритет в маппинге ниже.
        const ratingYear = await resolveRatingYear();

        const needsRatingsQuery = rows.some((r) => r.current_score === undefined);
        const needsParticipationQuery = rows.some((r) => r.participation_count === undefined);
        // year_grade приходит уже посчитанным из getFilteredStudents (см. yearGradeExpr там).
        // Одиночные пути (getById/findByCode/search) года не выбирают — для них "запрошенный год"
        // это всегда текущий, а класс за текущий год по тому же правилу равен живому row.grade.
        // Запрос к student_grade_history тут поэтому не нужен: единственный потребитель
        // прошлогоднего класса — /stats, а он всегда идёт через getFilteredStudents.
        //
        // Именно поэтому create()/update()/importLegacyStudents() историю НЕ пишут (это осознанно,
        // а не забытый случай): пока год текущий, истина — живой students.grade, а в историю
        // ученик попадёт снимком уходящего года на ближайшем повышении классов
        // (GradePromotionServicePg — единственное место, где класс меняется массово).

        const [ratingsRows, teacherRows, schoolRows, districtRows, participationRows] = await Promise.all([
            pg.selectFrom("student_year_ratings").select(["student_id", "year", "score", "average_score", "place", "district_place"]).where("student_id", "in", studentIds).orderBy("year").execute(),
            teacherIds.length > 0 ? pg.selectFrom("teachers").select(["id", "code", "fullname"]).where("id", "in", teacherIds).execute() : [],
            schoolIds.length > 0 ? pg.selectFrom("schools").select(["id", "code", "name"]).where("id", "in", schoolIds).execute() : [],
            districtIds.length > 0 ? pg.selectFrom("districts").select(["id", "code", "name"]).where("id", "in", districtIds).execute() : [],
            needsParticipationQuery
                ? pg.selectFrom("student_results").select(["student_id", ({ fn }) => fn.countAll().as("c")]).where("academic_year", "=", currentYear).where("student_id", "in", studentIds).groupBy("student_id").execute()
                : [],
        ]);

        const ratingsByStudent = new Map<number, YearRatingRow[]>();
        for (const r of ratingsRows) {
            if (!ratingsByStudent.has(r.student_id)) ratingsByStudent.set(r.student_id, []);
            ratingsByStudent.get(r.student_id)!.push({ year: r.year, score: r.score, averageScore: r.average_score, place: r.place, districtPlace: r.district_place });
        }
        const teacherById = new Map(teacherRows.map((t) => [t.id, t]));
        const schoolById = new Map(schoolRows.map((s) => [s.id, s]));
        const districtById = new Map(districtRows.map((d) => [d.id, d]));
        const participationById = new Map(participationRows.map((p: any) => [p.student_id, Number(p.c)]));

        return rows.map((row) => {
            const ratings = ratingsByStudent.get(row.id) ?? [];
            // row.current_score !== undefined = строку отдал СПИСОЧНЫЙ путь (getFilteredStudents):
            // там рейтинг уже приджойнен за нужный год, и null означает «за этот год рейтинга нет» —
            // это значимое значение, а не отсутствие данных. Подменять его строкой из ratings[]
            // нельзя: ratingYear здесь считает резолвер (последний год с рейтингами), и на /stats
            // с выбранным 2026/2027 вместо честных нулей показывались прошлогодние баллы, причём
            // сортировка при этом шла по настоящим NULL — то есть список ещё и был в случайном
            // порядке. `??` этого не ловил: он не отличает null от undefined.
            const hasJoinedRating = row.current_score !== undefined;
            const current = hasJoinedRating ? undefined : ratings.find((r) => r.year === ratingYear);
            const teacher = row.teacher_id !== null ? teacherById.get(row.teacher_id) : undefined;
            const school = row.school_id !== null ? schoolById.get(row.school_id) : undefined;
            const district = row.district_id !== null ? districtById.get(row.district_id) : undefined;
            const yearGrade = row.year_grade !== undefined ? row.year_grade : row.grade;

            return {
                id: row.id, code: row.code, lastName: row.last_name, firstName: row.first_name, middleName: row.middle_name,
                grade: row.grade, teacherId: row.teacher_id, schoolId: row.school_id, districtId: row.district_id,
                teacher: teacher ? { id: teacher.id, code: teacher.code, fullname: teacher.fullname } : null,
                school: school ? { id: school.id, code: school.code, name: school.name } : null,
                district: district ? { id: district.id, code: district.code, name: district.name } : null,
                maxLevel: row.max_level, status: row.status, avatarUrl: row.avatar_url,
                score: (hasJoinedRating ? row.current_score : current?.score) ?? null,
                averageScore: (hasJoinedRating ? row.current_average_score : current?.averageScore) ?? null,
                place: (hasJoinedRating ? row.current_place : current?.place) ?? null,
                districtPlace: (hasJoinedRating ? row.current_district_place : current?.districtPlace) ?? null,
                filterPlace: row.filter_place ?? null,
                participationCount: (row.participation_count ?? participationById.get(row.id)) ?? 0,
                ratings,
                yearGrade: yearGrade ?? null,
            };
        });
    }
}

export const studentServicePg = new StudentServicePg();
