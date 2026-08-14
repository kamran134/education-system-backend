import { sql, ExpressionBuilder } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";
import { CODE_DIVISORS } from "../utils/entity-codes.const";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

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
            month: r.month, year: r.year,
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

        // participationCount — теперь просто COUNT по academic_year (generated column), без ручного $or по месяцам.
        let base = pg
            .selectFrom("students")
            .leftJoin("student_year_ratings", (join) =>
                join.onRef("student_year_ratings.student_id", "=", "students.id").on("student_year_ratings.year", "=", currentYear)
            )
            .leftJoin(
                pg.selectFrom("student_results")
                    .select(["student_id", ({ fn }) => fn.countAll().as("participation_count")])
                    .where("academic_year", "=", currentYear)
                    .groupBy("student_id")
                    .as("participation"),
                (join) => join.onRef("participation.student_id", "=", "students.id")
            )
            .selectAll("students")
            .select([
                "student_year_ratings.score as current_score",
                "student_year_ratings.average_score as current_average_score",
                "student_year_ratings.place as current_place",
                "student_year_ratings.district_place as current_district_place",
                sql<number>`coalesce(participation.participation_count, 0)`.as("participation_count"),
            ]);
        base = this.applyFilter(base, filters);

        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const orderExpr = needsRatingJoin ? sql.ref(column) : column === "last_name"
            ? sql`students.last_name COLLATE az_ci`
            : sql.ref(`students.${column}`);
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST явно: ученики без строки в student_year_ratings (LEFT JOIN) иначе всплывают
        // в начало при DESC — Postgres по умолчанию сортирует NULL как "больше всех" значений.
        const query = base.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            query.execute(),
            this.applyFilter(pg.selectFrom("students"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        // filterPlace: dense rank по score внутри текущего среза фильтров (без code/search — текстовый
        // поиск не должен менять ранжирование), партиция по grade — точно как buildScorePlaceMap в Mongo-версии.
        const rankFilterOptions = { ...filters, code: undefined, search: undefined };
        const rankRows = await this.applyFilter(
            pg.selectFrom("students")
                .leftJoin("student_year_ratings", (join) =>
                    join.onRef("student_year_ratings.student_id", "=", "students.id").on("student_year_ratings.year", "=", currentYear)
                ),
            rankFilterOptions
        )
            .select(["students.id as id", sql<number>`coalesce(student_year_ratings.score, 0)`.as("score"), sql<number>`coalesce(students.grade, 0)`.as("grade")])
            .execute();

        const filterPlaceById = new Map<number, number>();
        const byGrade = new Map<number, typeof rankRows>();
        for (const r of rankRows) {
            if (!byGrade.has(r.grade)) byGrade.set(r.grade, []);
            byGrade.get(r.grade)!.push(r);
        }
        for (const group of byGrade.values()) {
            group.sort((a, b) => b.score - a.score);
            let place = 1, prevScore: number | null = null;
            group.forEach((r, i) => {
                if (i > 0 && r.score < prevScore!) place = i + 1;
                filterPlaceById.set(r.id, place);
                prevScore = r.score;
            });
        }

        const data = await this.attachExtras(rows, filterPlaceById);
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

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
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
            q = q.where("students.grade" as any, "in", filters.grades);
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
        const map: Record<string, string> = {
            code: "code", firstName: "first_name", lastName: "last_name",
            grade: "grade", status: "status",
        };
        return { column: map[column] ?? "last_name", needsRatingJoin: false };
    }

    private async attachExtras(rows: (StudentRow & Partial<{ current_score: number | null; current_average_score: number | null; current_place: number | null; current_district_place: number | null; participation_count: number }>)[], filterPlaceById?: Map<number, number>): Promise<Student[]> {
        if (rows.length === 0) return [];
        const studentIds = rows.map((r) => r.id);
        const teacherIds = [...new Set(rows.map((r) => r.teacher_id).filter((id): id is number => id !== null))];
        const schoolIds = [...new Set(rows.map((r) => r.school_id).filter((id): id is number => id !== null))];
        const districtIds = [...new Set(rows.map((r) => r.district_id).filter((id): id is number => id !== null))];
        const currentYear = getCurrentAcademicYear();

        const needsRatingsQuery = rows.some((r) => r.current_score === undefined);
        const needsParticipationQuery = rows.some((r) => r.participation_count === undefined);

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
            const current = ratings.find((r) => r.year === currentYear);
            const teacher = row.teacher_id !== null ? teacherById.get(row.teacher_id) : undefined;
            const school = row.school_id !== null ? schoolById.get(row.school_id) : undefined;
            const district = row.district_id !== null ? districtById.get(row.district_id) : undefined;

            return {
                id: row.id, code: row.code, lastName: row.last_name, firstName: row.first_name, middleName: row.middle_name,
                grade: row.grade, teacherId: row.teacher_id, schoolId: row.school_id, districtId: row.district_id,
                teacher: teacher ? { id: teacher.id, code: teacher.code, fullname: teacher.fullname } : null,
                school: school ? { id: school.id, code: school.code, name: school.name } : null,
                district: district ? { id: district.id, code: district.code, name: district.name } : null,
                maxLevel: row.max_level, status: row.status, avatarUrl: row.avatar_url,
                score: (row.current_score ?? current?.score) ?? null,
                averageScore: (row.current_average_score ?? current?.averageScore) ?? null,
                place: (row.current_place ?? current?.place) ?? null,
                districtPlace: (row.current_district_place ?? current?.districtPlace) ?? null,
                filterPlace: filterPlaceById?.get(row.id) ?? null,
                participationCount: (row.participation_count ?? participationById.get(row.id)) ?? 0,
                ratings,
            };
        });
    }
}

export const studentServicePg = new StudentServicePg();
