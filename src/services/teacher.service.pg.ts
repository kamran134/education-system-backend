import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
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

export interface Teacher {
    id: number;
    code: number;
    fullname: string;
    schoolId: number | null;
    districtId: number | null;
    school: EntitySummary | null;
    district: EntitySummary | null;
    studentCount: number | null;
    status: string | null;
    teacherOfTheYearScore: number | null;
    active: boolean;
    avatarUrl: string | null;
    score: number | null;
    averageScore: number | null;
    place: number | null;
    districtPlace: number | null;
    ratings: YearRatingRow[];
}

export interface TeacherCreate {
    code: number;
    fullname: string;
    schoolId?: number | null;
    districtId?: number | null;
    studentCount?: number;
    status?: string;
    teacherOfTheYearScore?: number;
    active?: boolean;
}

type TeacherRow = {
    id: number; code: number; fullname: string; school_id: number | null; district_id: number | null;
    student_count: number | null; status: string | null; teacher_of_the_year_score: number | null;
    active: boolean; avatar_url: string | null;
};

/** Postgres-версия TeacherService. См. district/school.service.pg.ts для общих решений. */
export class TeacherServicePg {
    async updateTeachersStats(): Promise<void> {
        throw new Error("updateTeachersStats: перенос отложен до переписывания stats.service.ts");
    }

    async findById(id: number): Promise<Teacher | null> {
        const row = await pg.selectFrom("teachers").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async findByCode(code: number): Promise<Teacher | null> {
        const row = await pg.selectFrom("teachers").selectAll().where("code", "=", code).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async create(data: TeacherCreate): Promise<Teacher> {
        const row = await pg
            .insertInto("teachers")
            .values({
                code: data.code,
                fullname: data.fullname,
                school_id: data.schoolId ?? null,
                district_id: data.districtId ?? null,
                student_count: data.studentCount ?? null,
                status: data.status ?? null,
                teacher_of_the_year_score: data.teacherOfTheYearScore ?? 0,
                active: data.active ?? true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return (await this.attachExtras([row]))[0];
    }

    async update(id: number, data: Partial<TeacherCreate>): Promise<Teacher> {
        const row = await pg
            .updateTable("teachers")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.fullname !== undefined && { fullname: data.fullname }),
                ...(data.schoolId !== undefined && { school_id: data.schoolId }),
                ...(data.districtId !== undefined && { district_id: data.districtId }),
                ...(data.studentCount !== undefined && { student_count: data.studentCount }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.teacherOfTheYearScore !== undefined && { teacher_of_the_year_score: data.teacherOfTheYearScore }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Teacher not found");
        return (await this.attachExtras([row]))[0];
    }

    /** Каскад: результаты учеников → ученики → учитель. Одна транзакция. */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            const students = await trx.selectFrom("students").select("id").where("teacher_id", "=", id).execute();
            const studentIds = students.map((s) => s.id);

            if (studentIds.length > 0) {
                await trx.deleteFrom("student_results").where("student_id", "in", studentIds).execute();
                await trx.deleteFrom("students").where("teacher_id", "=", id).execute();
            }

            const result = await trx.deleteFrom("teachers").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("Teacher not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        for (const id of ids) await this.delete(id);
        return { insertedCount: 0, modifiedCount: 0, deletedCount: ids.length, errors: [] };
    }

    /**
     * Реальная функция (в отличие от school.repairSchoolAssignments): school_id/district_id
     * учителя nullable и в Postgres — 2 таких случая уже в проде (см. PG_MIGRATION_TASKS.md шаг 3).
     */
    async repairTeacherAssignments(): Promise<{
        repairedTeachers: number[];
        failedTeachers: Array<{ code: number; reason: string }>;
        missedDistricts: number[];
        missedSchools: number[];
    }> {
        const teachers = await pg.selectFrom("teachers").selectAll().where(({ eb, or }) => or([eb("school_id", "is", null), eb("district_id", "is", null)])).execute();

        const repairedTeachers: number[] = [];
        const failedTeachers: Array<{ code: number; reason: string }> = [];
        const missedDistricts: number[] = [];
        const missedSchools: number[] = [];

        const [allSchools, allDistricts] = await Promise.all([
            pg.selectFrom("schools").select(["id", "code"]).execute(),
            pg.selectFrom("districts").select(["id", "code"]).execute(),
        ]);
        const schoolByCode = new Map(allSchools.map((s) => [s.code, s.id]));
        const districtByCode = new Map(allDistricts.map((d) => [d.code, d.id]));

        for (const teacher of teachers) {
            try {
                const schoolCode = Math.floor(teacher.code / CODE_DIVISORS.TEACHER_TO_SCHOOL);
                const districtCode = Math.floor(teacher.code / CODE_DIVISORS.TEACHER_TO_DISTRICT);
                const patch: { school_id?: number; district_id?: number } = {};

                if (teacher.school_id === null) {
                    const schoolId = schoolByCode.get(schoolCode);
                    if (schoolId !== undefined) patch.school_id = schoolId;
                    else missedSchools.push(teacher.code);
                }
                if (teacher.district_id === null) {
                    const districtId = districtByCode.get(districtCode);
                    if (districtId !== undefined) patch.district_id = districtId;
                    else missedDistricts.push(teacher.code);
                }

                if (Object.keys(patch).length > 0) {
                    await pg.updateTable("teachers").set(patch).where("id", "=", teacher.id).execute();
                    repairedTeachers.push(teacher.code);
                }
            } catch (error) {
                failedTeachers.push({ code: teacher.code, reason: error instanceof Error ? error.message : "Unknown" });
            }
        }

        return { repairedTeachers, failedTeachers, missedDistricts, missedSchools };
    }

    async getFilteredTeachers(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Teacher[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();

        let base = pg
            .selectFrom("teachers")
            .leftJoin("teacher_year_ratings", (join) =>
                join.onRef("teacher_year_ratings.teacher_id", "=", "teachers.id").on("teacher_year_ratings.year", "=", currentYear)
            )
            .selectAll("teachers")
            .select(["teacher_year_ratings.score as current_score", "teacher_year_ratings.average_score as current_average_score"]);
        base = this.applyFilter(base, filters);

        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const orderExpr = column === "fullname" ? sql`teachers.fullname COLLATE az_ci` : sql.ref(needsRatingJoin ? column : `teachers.${column}`);
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST явно: учителя без строки в teacher_year_ratings (LEFT JOIN) иначе всплывают
        // в начало при DESC — Postgres по умолчанию сортирует NULL как "больше всех" значений.
        const query = base.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            query.execute(),
            this.applyFilter(pg.selectFrom("teachers"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        const data = await this.attachExtras(rows);
        return { data, totalCount: Number(countRow.count) };
    }

    async getTeachersForFilter(filters: FilterOptionsPg): Promise<Teacher[]> {
        let query = pg.selectFrom("teachers").selectAll();
        query = this.applyFilter(query, filters);
        const rows = await query.orderBy(sql`fullname COLLATE az_ci`).execute();
        return await this.attachExtras(rows);
    }

    async processTeachersFromExcel(filePath: string): Promise<FileProcessingResult<Teacher>> {
        const processedData: Teacher[] = [];
        const errors: string[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 5) {
                throw new Error("Faylda kifayət qədər sətr yoxdur!");
            }

            const rows = data.slice(4);
            const dataToInsert = rows.map((row: any) => ({
                districtCode: Number(row[1]) || 0,
                schoolCode: Number(row[2]) || 0,
                code: Number(row[3]),
                fullname: String(row[4]),
            }));

            const correctTeachersToInsert = dataToInsert.filter((d) => d.code > 999999);
            const incorrectTeacherCodes = dataToInsert.filter((d) => d.code <= 999999).map((d) => d.code);

            const existingTeacherCodes = await this.checkExistingTeacherCodes(correctTeachersToInsert.map((d) => d.code));
            const newTeachers = correctTeachersToInsert.filter((d) => !existingTeacherCodes.includes(d.code));

            const districtCodes = newTeachers.filter((t) => t.districtCode > 0).map((t) => t.districtCode);
            const schoolCodes = newTeachers.filter((t) => t.schoolCode > 0).map((t) => t.schoolCode);
            const teacherCodesWithoutSchoolCodes = newTeachers.filter((t) => t.schoolCode === 0).map((t) => t.code);

            const existingDistricts = districtCodes.length > 0 ? await pg.selectFrom("districts").select(["id", "code"]).where("code", "in", districtCodes).execute() : [];
            const existingSchools = schoolCodes.length > 0 ? await pg.selectFrom("schools").select(["id", "code"]).where("code", "in", schoolCodes).execute() : [];

            const existingDistrictCodes = existingDistricts.map((d) => d.code);
            const existingSchoolCodes = existingSchools.map((s) => s.code);
            const missingSchoolCodes = schoolCodes.filter((c) => !existingSchoolCodes.includes(c));
            const missingDistrictCodes = districtCodes.filter((c) => !existingDistrictCodes.includes(c));

            const schoolMap = new Map(existingSchools.map((s) => [s.code, s.id]));
            const districtMap = new Map(existingDistricts.map((d) => [d.code, d.id]));

            const teachersToSave = newTeachers.filter(
                (t) => t.code > 0 && !missingDistrictCodes.includes(t.districtCode) && !missingSchoolCodes.includes(t.schoolCode) && !teacherCodesWithoutSchoolCodes.includes(t.code)
            );

            if (teachersToSave.length > 0) {
                await pg
                    .insertInto("teachers")
                    .values(
                        teachersToSave.map((t) => ({
                            code: t.code, fullname: t.fullname,
                            district_id: districtMap.get(t.districtCode) ?? null,
                            school_id: schoolMap.get(t.schoolCode) ?? null,
                            active: true,
                        }))
                    )
                    .onConflict((oc) => oc.column("code").doUpdateSet((eb) => ({ fullname: eb.ref("excluded.fullname"), school_id: eb.ref("excluded.school_id"), district_id: eb.ref("excluded.district_id") })))
                    .execute();

                const savedRows = await pg.selectFrom("teachers").selectAll().where("code", "in", teachersToSave.map((t) => t.code)).execute();
                processedData.push(...(await this.attachExtras(savedRows)));
            }

            await deleteFile(filePath).catch(() => {});

            return {
                processedData,
                errors,
                skippedItems: [],
                validationErrors: {
                    incorrectTeacherCodes,
                    missingSchoolCodes: [...new Set(missingSchoolCodes)],
                    teacherCodesWithoutSchoolCodes,
                    existingTeacherCodes,
                },
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    async checkExistingTeacherCodes(codes: number[]): Promise<number[]> {
        if (codes.length === 0) return [];
        const rows = await pg.selectFrom("teachers").select("code").where("code", "in", codes).execute();
        return rows.map((r) => r.code);
    }

    /** Одноразовый импорт исторических данных 2024 года — см. LEGACY_IMPORT_PLAN.md. */
    async importLegacyTeachers(records: any[]): Promise<{ inserted: number; updated: number; skipped: number; errors: number; details: { skippedCodes: number[]; errorMessages: string[] } }> {
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

                const existing = await pg.selectFrom("teachers").select("id").where("code", "=", code).executeTakeFirst();
                if (existing) {
                    const has2024 = await pg.selectFrom("teacher_year_ratings").select("year").where("teacher_id", "=", existing.id).where("year", "=", LEGACY_YEAR).executeTakeFirst();
                    if (has2024) {
                        skipped++;
                        skippedCodes.push(code);
                        continue;
                    }
                    const score = typeof record.score === "number" ? record.score : 0;
                    const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;
                    await pg.insertInto("teacher_year_ratings").values({ teacher_id: existing.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                    updated++;
                    continue;
                }

                const schoolCode = Math.floor(code / CODE_DIVISORS.TEACHER_TO_SCHOOL);
                const districtCode = Math.floor(code / CODE_DIVISORS.TEACHER_TO_DISTRICT);

                const schoolRow = schoolCode ? await pg.selectFrom("schools").select("id").where("code", "=", schoolCode).executeTakeFirst() : undefined;
                const districtRow = districtCode ? await pg.selectFrom("districts").select("id").where("code", "=", districtCode).executeTakeFirst() : undefined;

                const score = typeof record.score === "number" ? record.score : 0;
                const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;

                const created = await pg
                    .insertInto("teachers")
                    .values({
                        code, fullname: record.fullname || "",
                        school_id: schoolRow?.id ?? null, district_id: districtRow?.id ?? null,
                        active: record.active !== undefined ? Boolean(record.active) : true,
                    })
                    .returning("id")
                    .executeTakeFirstOrThrow();
                await pg.insertInto("teacher_year_ratings").values({ teacher_id: created.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`Teacher code ${record.code}: ${err.message}`);
            }
        }

        return { inserted, updated, skipped, errors, details: { skippedCodes, errorMessages } };
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 7);
            q = q.where("teachers.code" as any, ">=", parseInt(start)).where("teachers.code" as any, "<=", parseInt(end));
        }
        if (filters.search) {
            q = q.where(sql`teachers.fullname`, "ilike", `%${escapeRegex(filters.search)}%`);
        }
        if (filters.active !== undefined) {
            q = q.where("teachers.active" as any, "=", filters.active);
        }
        // Приоритет как в Mongo-версии: schoolIds важнее districtIds (не оба сразу).
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            q = q.where("teachers.school_id" as any, "in", filters.schoolIds);
        } else if (filters.districtIds && filters.districtIds.length > 0) {
            q = q.where("teachers.district_id" as any, "in", filters.districtIds);
        }
        return q;
    }

    private mapSortColumn(column: string): { column: string; needsRatingJoin: boolean } {
        if (column === "score") return { column: "current_score", needsRatingJoin: true };
        if (column === "averageScore") return { column: "current_average_score", needsRatingJoin: true };
        const map: Record<string, string> = {
            code: "code", fullname: "fullname",
            studentCount: "student_count", status: "status", active: "active",
        };
        // "name" (дефолт из контроллера) не существует у Teacher ни в Mongo, ни здесь — там это было
        // молчаливым no-op (Mongo не роняет sort по несуществующему полю), тут явный fallback на fullname.
        return { column: map[column] ?? "fullname", needsRatingJoin: false };
    }

    private async attachExtras(rows: TeacherRow[]): Promise<Teacher[]> {
        if (rows.length === 0) return [];
        const teacherIds = rows.map((r) => r.id);
        const schoolIds = [...new Set(rows.map((r) => r.school_id).filter((id): id is number => id !== null))];
        const districtIds = [...new Set(rows.map((r) => r.district_id).filter((id): id is number => id !== null))];
        const currentYear = getCurrentAcademicYear();

        const [ratingsRows, schoolRows, districtRows] = await Promise.all([
            pg.selectFrom("teacher_year_ratings").select(["teacher_id", "year", "score", "average_score", "place", "district_place"]).where("teacher_id", "in", teacherIds).orderBy("year").execute(),
            schoolIds.length > 0 ? pg.selectFrom("schools").select(["id", "code", "name"]).where("id", "in", schoolIds).execute() : [],
            districtIds.length > 0 ? pg.selectFrom("districts").select(["id", "code", "name"]).where("id", "in", districtIds).execute() : [],
        ]);

        const ratingsByTeacher = new Map<number, YearRatingRow[]>();
        for (const r of ratingsRows) {
            if (!ratingsByTeacher.has(r.teacher_id)) ratingsByTeacher.set(r.teacher_id, []);
            ratingsByTeacher.get(r.teacher_id)!.push({ year: r.year, score: r.score, averageScore: r.average_score, place: r.place, districtPlace: r.district_place });
        }
        const schoolById = new Map(schoolRows.map((s) => [s.id, s]));
        const districtById = new Map(districtRows.map((d) => [d.id, d]));

        return rows.map((row) => {
            const ratings = ratingsByTeacher.get(row.id) ?? [];
            const current = ratings.find((r) => r.year === currentYear);
            const school = row.school_id !== null ? schoolById.get(row.school_id) : undefined;
            const district = row.district_id !== null ? districtById.get(row.district_id) : undefined;
            return {
                id: row.id, code: row.code, fullname: row.fullname,
                schoolId: row.school_id, districtId: row.district_id,
                school: school ? { id: school.id, code: school.code, name: school.name } : null,
                district: district ? { id: district.id, code: district.code, name: district.name } : null,
                studentCount: row.student_count, status: row.status,
                teacherOfTheYearScore: row.teacher_of_the_year_score, active: row.active, avatarUrl: row.avatar_url,
                score: current?.score ?? null, averageScore: current?.averageScore ?? null,
                place: current?.place ?? null, districtPlace: current?.districtPlace ?? null,
                ratings,
            };
        });
    }
}

export const teacherServicePg = new TeacherServicePg();
