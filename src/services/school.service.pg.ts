import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { escapeRegex } from "../utils/validation.util";
import { CODE_RANGES, CODE_DIVISORS } from "../utils/entity-codes.const";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export interface YearRatingRow {
    year: number;
    score: number | null;
    averageScore: number | null;
    place: number | null;
    districtPlace: number | null;
}

export interface DistrictSummary {
    id: number;
    code: number;
    name: string;
}

export interface School {
    id: number;
    code: number;
    name: string;
    address: string | null;
    districtId: number;
    districtCode: number | null; // денормализация Mongo (school.districtCode) — здесь вычисляется джойном, не хранится
    district: DistrictSummary | null;
    studentCount: number | null;
    status: string | null;
    schoolOfTheYearScore: number | null;
    active: boolean;
    avatarUrl: string | null;
    // Текущий год — из school_year_ratings (то, что реально в последний раз посчитал stats.service),
    // а не из view v_school_year_scores (та всегда живая и может разойтись, см. db/rating-semantics.md).
    score: number | null;
    averageScore: number | null;
    place: number | null;
    districtPlace: number | null;
    ratings: YearRatingRow[];
}

export interface SchoolCreate {
    code: number;
    name: string;
    address?: string | null;
    districtId: number;
    studentCount?: number;
    status?: string;
    schoolOfTheYearScore?: number;
    active?: boolean;
}

type SchoolRow = {
    id: number; code: number; name: string; address: string | null; district_id: number;
    student_count: number | null; status: string | null; school_of_the_year_score: number | null;
    active: boolean; avatar_url: string | null;
};

/**
 * Postgres-версия SchoolService. См. district.service.pg.ts для общих решений (id — число,
 * транзакционный каскад удаления, параллельные *Pg-утилиты вместо Mongo-версий).
 *
 * Отличия от district: district_id NOT NULL (после чистки трёх мусорных школ, см. PG_MIGRATION_TASKS.md
 * шаг 3 находка 1) — repairSchoolAssignments теперь структурно невозможный сценарий, не просто редкий.
 */
export class SchoolServicePg {
    async updateSchoolsStats(): Promise<void> {
        throw new Error("updateSchoolsStats: перенос отложен до переписывания stats.service.ts");
    }

    async findById(id: number): Promise<School | null> {
        const row = await pg.selectFrom("schools").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async findByCode(code: number): Promise<School | null> {
        const row = await pg.selectFrom("schools").selectAll().where("code", "=", code).executeTakeFirst();
        if (!row) return null;
        return (await this.attachExtras([row]))[0];
    }

    async create(data: SchoolCreate): Promise<School> {
        const row = await pg
            .insertInto("schools")
            .values({
                code: data.code,
                name: data.name,
                address: data.address ?? null,
                district_id: data.districtId,
                student_count: data.studentCount ?? null,
                status: data.status ?? null,
                school_of_the_year_score: data.schoolOfTheYearScore ?? 0,
                active: data.active ?? true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return (await this.attachExtras([row]))[0];
    }

    async update(id: number, data: Partial<SchoolCreate>): Promise<School> {
        const row = await pg
            .updateTable("schools")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.address !== undefined && { address: data.address }),
                ...(data.districtId !== undefined && { district_id: data.districtId }),
                ...(data.studentCount !== undefined && { student_count: data.studentCount }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.schoolOfTheYearScore !== undefined && { school_of_the_year_score: data.schoolOfTheYearScore }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("School not found");
        return (await this.attachExtras([row]))[0];
    }

    /** Каскад: учителя → результаты учеников → ученики → школа. Одна транзакция. */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            const teachers = await trx.selectFrom("teachers").select("id").where("school_id", "=", id).execute();
            const teacherIds = teachers.map((t) => t.id);

            const students = await trx.selectFrom("students").select("id").where("school_id", "=", id).execute();
            const studentIds = students.map((s) => s.id);

            if (studentIds.length > 0) {
                await trx.deleteFrom("student_results").where("student_id", "in", studentIds).execute();
            }
            if (teacherIds.length > 0) {
                await trx.deleteFrom("teachers").where("school_id", "=", id).execute();
            }
            if (studentIds.length > 0) {
                await trx.deleteFrom("students").where("school_id", "=", id).execute();
            }

            const result = await trx.deleteFrom("schools").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("School not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        for (const id of ids) await this.delete(id);
        return { insertedCount: 0, modifiedCount: 0, deletedCount: ids.length, errors: [] };
    }

    async getFilteredSchools(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: School[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();

        let base = pg
            .selectFrom("schools")
            .leftJoin("school_year_ratings", (join) =>
                join.onRef("school_year_ratings.school_id", "=", "schools.id").on("school_year_ratings.year", "=", currentYear)
            )
            .selectAll("schools")
            .select(["school_year_ratings.score as current_score", "school_year_ratings.average_score as current_average_score"]);
        base = this.applyFilter(base, filters);

        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const orderExpr = column === "name" ? sql`schools.name COLLATE az_ci` : sql.ref(needsRatingJoin ? column : `schools.${column}`);
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST явно: школы без строки в school_year_ratings (LEFT JOIN) иначе всплывают
        // в начало при DESC — Postgres по умолчанию сортирует NULL как "больше всех" значений.
        const query = base.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            query.execute(),
            this.applyFilter(pg.selectFrom("schools"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        const data = await this.attachExtras(rows);
        return { data, totalCount: Number(countRow.count) };
    }

    async getSchoolsForFilter(filters: FilterOptionsPg): Promise<School[]> {
        let query = pg.selectFrom("schools").selectAll();
        query = this.applyFilter(query, filters);
        const rows = await query.orderBy(sql`name COLLATE az_ci`).execute();
        return await this.attachExtras(rows);
    }

    async processSchoolsFromExcel(filePath: string): Promise<FileProcessingResult<School>> {
        const processedData: School[] = [];
        const errors: string[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 5) {
                throw new Error("Faylda kifayət qədər sətr yoxdur!");
            }

            const rows = data.slice(4);
            const dataToInsert = rows.map((row: any) => ({
                districtCode: Number(row[1]) || 0,
                code: Number(row[2]),
                name: String(row[3]),
                address: "",
            }));

            const correctSchoolsToInsert = dataToInsert.filter((d) => d.code >= CODE_RANGES.SCHOOL_MIN);
            const incorrectSchoolCodes = dataToInsert.filter((d) => d.code < CODE_RANGES.SCHOOL_MIN).map((d) => d.code);

            const existingSchoolCodes = await this.checkExistingSchoolCodes(correctSchoolsToInsert.map((d) => d.code));
            const newSchools = correctSchoolsToInsert.filter((d) => !existingSchoolCodes.includes(d.code));

            const districtCodes = newSchools.filter((s) => s.districtCode > 0).map((s) => s.districtCode);
            const schoolCodesWithoutDistrictCodes = newSchools.filter((s) => s.districtCode === 0).map((s) => s.code);

            const existingDistricts = districtCodes.length > 0
                ? await pg.selectFrom("districts").select(["id", "code"]).where("code", "in", districtCodes).execute()
                : [];
            const existingDistrictCodes = existingDistricts.map((d) => d.code);
            const missingDistrictCodes = districtCodes.filter((c) => !existingDistrictCodes.includes(c));
            const districtMap = new Map(existingDistricts.map((d) => [d.code, d.id]));

            const schoolsToSave = newSchools.filter(
                (s) => s.code > 0 && !missingDistrictCodes.includes(s.districtCode) && !schoolCodesWithoutDistrictCodes.includes(s.code)
            );

            if (schoolsToSave.length > 0) {
                await pg
                    .insertInto("schools")
                    .values(
                        schoolsToSave.map((s) => ({
                            code: s.code, name: s.name, address: s.address,
                            district_id: districtMap.get(s.districtCode)!, active: true,
                        }))
                    )
                    .onConflict((oc) => oc.column("code").doUpdateSet((eb) => ({ name: eb.ref("excluded.name"), district_id: eb.ref("excluded.district_id") })))
                    .execute();

                const savedRows = await pg.selectFrom("schools").selectAll().where("code", "in", schoolsToSave.map((s) => s.code)).execute();
                processedData.push(...(await this.attachExtras(savedRows)));
            }

            await deleteFile(filePath).catch(() => {});

            return {
                processedData,
                errors,
                skippedItems: [],
                validationErrors: {
                    incorrectSchoolCodes,
                    missingDistrictCodes: [...new Set(missingDistrictCodes)],
                    schoolCodesWithoutDistrictCodes,
                    existingSchoolCodes,
                },
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    async checkExistingSchoolCodes(codes: number[]): Promise<number[]> {
        if (codes.length === 0) return [];
        const rows = await pg.selectFrom("schools").select("code").where("code", "in", codes).execute();
        return rows.map((r) => r.code);
    }

    /**
     * В Postgres district_id — NOT NULL (мусорные школы без района исключены при переносе,
     * см. PG_MIGRATION_TASKS.md шаг 3). Сценарий "школа без района" структурно невозможен —
     * метод оставлен для совместимости API, всегда возвращает пустой результат.
     */
    async repairSchoolAssignments(): Promise<{ repairedSchools: number[]; failedSchools: Array<{ code: number; reason: string }>; missedDistricts: number[] }> {
        return { repairedSchools: [], failedSchools: [], missedDistricts: [] };
    }

    /** Одноразовый импорт исторических данных 2024 года — см. LEGACY_IMPORT_PLAN.md. */
    async importLegacySchools(records: any[]): Promise<{ inserted: number; updated: number; skipped: number; errors: number; details: { skippedCodes: number[]; errorMessages: string[] } }> {
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

                const existing = await pg.selectFrom("schools").select("id").where("code", "=", code).executeTakeFirst();
                if (existing) {
                    const has2024 = await pg.selectFrom("school_year_ratings").select("year").where("school_id", "=", existing.id).where("year", "=", LEGACY_YEAR).executeTakeFirst();
                    if (has2024) {
                        skipped++;
                        skippedCodes.push(code);
                        continue;
                    }
                    const score = typeof record.score === "number" ? record.score : 0;
                    const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;
                    await pg.insertInto("school_year_ratings").values({ school_id: existing.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                    updated++;
                    continue;
                }

                const districtCode = Number(record.districtCode);
                const districtRow = districtCode && !isNaN(districtCode)
                    ? await pg.selectFrom("districts").select("id").where("code", "=", districtCode).executeTakeFirst()
                    : undefined;

                if (!districtRow) {
                    errors++;
                    errorMessages.push(`School code ${code}: district ${record.districtCode} not found (district_id обязателен в Postgres)`);
                    continue;
                }

                const score = typeof record.score === "number" ? record.score : 0;
                const averageScore = typeof record.averageScore === "number" ? record.averageScore : 0;

                const created = await pg
                    .insertInto("schools")
                    .values({
                        code, name: record.name || "", address: record.address || "",
                        district_id: districtRow.id, active: record.active !== undefined ? Boolean(record.active) : true,
                    })
                    .returning("id")
                    .executeTakeFirstOrThrow();
                await pg.insertInto("school_year_ratings").values({ school_id: created.id, year: LEGACY_YEAR, score, average_score: averageScore, place: null, district_place: null }).execute();
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`School code ${record.code}: ${err.message}`);
            }
        }

        return { inserted, updated, skipped, errors, details: { skippedCodes, errorMessages } };
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 5);
            q = q.where("schools.code" as any, ">=", parseInt(start)).where("schools.code" as any, "<=", parseInt(end));
        }
        if (filters.search) {
            q = q.where(sql`schools.name`, "ilike", `%${escapeRegex(filters.search)}%`);
        }
        if (filters.active !== undefined) {
            q = q.where("schools.active" as any, "=", filters.active);
        }
        if (filters.districtIds && filters.districtIds.length > 0) {
            q = q.where("schools.district_id" as any, "in", filters.districtIds);
        }
        return q;
    }

    private mapSortColumn(column: string): { column: string; needsRatingJoin: boolean } {
        if (column === "score") return { column: "current_score", needsRatingJoin: true };
        if (column === "averageScore") return { column: "current_average_score", needsRatingJoin: true };
        const map: Record<string, string> = {
            code: "code", name: "name", address: "address",
            studentCount: "student_count", status: "status", active: "active",
        };
        return { column: map[column] ?? "current_average_score", needsRatingJoin: !(column in map) };
    }

    private async attachExtras(rows: SchoolRow[]): Promise<School[]> {
        if (rows.length === 0) return [];
        const schoolIds = rows.map((r) => r.id);
        const districtIds = [...new Set(rows.map((r) => r.district_id))];
        const currentYear = getCurrentAcademicYear();

        const [ratingsRows, districtRows] = await Promise.all([
            pg.selectFrom("school_year_ratings").select(["school_id", "year", "score", "average_score", "place", "district_place"]).where("school_id", "in", schoolIds).orderBy("year").execute(),
            pg.selectFrom("districts").select(["id", "code", "name"]).where("id", "in", districtIds).execute(),
        ]);

        const ratingsBySchool = new Map<number, YearRatingRow[]>();
        for (const r of ratingsRows) {
            if (!ratingsBySchool.has(r.school_id)) ratingsBySchool.set(r.school_id, []);
            ratingsBySchool.get(r.school_id)!.push({ year: r.year, score: r.score, averageScore: r.average_score, place: r.place, districtPlace: r.district_place });
        }
        const districtById = new Map(districtRows.map((d) => [d.id, d]));

        return rows.map((row) => {
            const ratings = ratingsBySchool.get(row.id) ?? [];
            const current = ratings.find((r) => r.year === currentYear);
            const district = districtById.get(row.district_id) ?? null;
            return {
                id: row.id, code: row.code, name: row.name, address: row.address,
                districtId: row.district_id, districtCode: district?.code ?? null,
                district: district ? { id: district.id, code: district.code, name: district.name } : null,
                studentCount: row.student_count, status: row.status,
                schoolOfTheYearScore: row.school_of_the_year_score, active: row.active, avatarUrl: row.avatar_url,
                score: current?.score ?? null, averageScore: current?.averageScore ?? null,
                place: current?.place ?? null, districtPlace: current?.districtPlace ?? null,
                ratings,
            };
        });
    }
}

export const schoolServicePg = new SchoolServicePg();
