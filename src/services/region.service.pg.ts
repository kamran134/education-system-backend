import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export interface YearRatingRow {
    year: number;
    score: number | null;
    averageScore: number | null;
    place: number | null;
}

export interface Region {
    id: number;
    code: number;
    name: string;
    regionOfTheYearScore: number | null;
    active: boolean;
    avatarUrl: string | null;
    districtCount: number;
    studentCount: number;
    ratings: YearRatingRow[];
}

export interface RegionCreate {
    code: number;
    name: string;
    regionOfTheYearScore?: number;
    active?: boolean;
}

/**
 * Postgres-версия RegionService (PHASE3 п.1б, REGIONS_TASKS.md). Зеркалит DistrictServicePg
 * почти 1:1 — публичный контракт (форма ответа, имена методов) намеренно тот же.
 *
 * Отличия от районного оригинала, все намеренные (см. REGIONS_TASKS.md шаг 4):
 *   - code — 2 знака, не 3 (собственное кодовое пространство региона, не связано с кодами районов).
 *   - districtCount/studentCount — ЖИВОЙ count(), не денормализованное поле: у региона нет
 *     колонки student_count в схеме (решение 08.08.2026, см. db/migrations/005_regions.sql).
 *   - delete() НЕ каскадит вниз: район переживает удаление своего РТИ (SET region_id = NULL),
 *     в отличие от district.service.pg.ts, где удаление района каскадом чистит школы/учителей/учеников.
 *   - Нет processRegionsFromExcel/checkExistingRegionCodes/countRegionsRates/updateRegionsStats —
 *     регионов всего 12, заводятся сидом миграции, импорта из Excel не будет.
 */
export class RegionServicePg {
    async findById(id: number): Promise<Region | null> {
        const row = await pg.selectFrom("regions").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return await this.attachExtras(row);
    }

    async findByCode(code: number): Promise<Region | null> {
        const row = await pg.selectFrom("regions").selectAll().where("code", "=", code).executeTakeFirst();
        if (!row) return null;
        return await this.attachExtras(row);
    }

    async create(data: RegionCreate): Promise<Region> {
        const row = await pg
            .insertInto("regions")
            .values({
                code: data.code,
                name: data.name,
                region_of_the_year_score: data.regionOfTheYearScore ?? 0,
                active: data.active ?? true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return await this.attachExtras(row);
    }

    async update(id: number, data: Partial<RegionCreate>): Promise<Region> {
        const row = await pg
            .updateTable("regions")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.regionOfTheYearScore !== undefined && { region_of_the_year_score: data.regionOfTheYearScore }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Region not found");
        return await this.attachExtras(row);
    }

    /**
     * НЕ каскадит вниз (см. класс-докстринг). Районы этого региона переживают удаление —
     * только теряют привязку (region_id = NULL).
     */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            await trx.updateTable("districts").set({ region_id: null }).where("region_id", "=", id).execute();

            const result = await trx.deleteFrom("regions").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("Region not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        for (const id of ids) {
            await this.delete(id);
        }
        return { insertedCount: 0, modifiedCount: 0, deletedCount: ids.length, errors: [] };
    }

    async getFilteredRegions(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Region[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();

        let query = pg
            .selectFrom("regions")
            .leftJoin("region_year_ratings", (join) =>
                join.onRef("region_year_ratings.region_id", "=", "regions.id").on("region_year_ratings.year", "=", currentYear)
            )
            .selectAll("regions")
            .select(["region_year_ratings.score as current_score", "region_year_ratings.average_score as current_average_score", "region_year_ratings.place as current_place"]);
        query = this.applyFilter(query, filters);

        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const orderExpr = column === "name" ? sql`regions.name COLLATE az_ci` : sql.ref(needsRatingJoin ? column : `regions.${column}`);
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST — регионы без строки в region_year_ratings (LEFT JOIN) иначе всплывают
        // в начало при DESC, тот же баг, что уже был найден и исправлен у district/school/teacher.
        const finalQuery = query.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            finalQuery.execute(),
            this.applyFilter(pg.selectFrom("regions"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        const data = await Promise.all(rows.map((r) => this.attachExtras(r)));
        return { data, totalCount: Number(countRow.count) };
    }

    async getRegionsForFilter(filters: FilterOptionsPg): Promise<Region[]> {
        let query = pg.selectFrom("regions").selectAll();
        query = this.applyFilter(query, filters);
        const rows = await query.orderBy(sql`name COLLATE az_ci`).execute();
        return await Promise.all(rows.map((r) => this.attachExtras(r)));
    }

    async checkExistingRegionCodes(codes: number[]): Promise<number[]> {
        if (codes.length === 0) return [];
        const rows = await pg.selectFrom("regions").select("code").where("code", "in", codes).execute();
        return rows.map((r) => r.code);
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 2);
            q = q.where("code", ">=", parseInt(start)).where("code", "<=", parseInt(end));
        }
        if (filters.search) {
            q = q.where(sql`name`, "ilike", `%${escapeRegex(filters.search)}%`);
        }
        if (filters.active !== undefined) {
            q = q.where("active", "=", filters.active);
        }
        return q;
    }

    private mapSortColumn(column: string): { column: string; needsRatingJoin: boolean } {
        if (column === "score") return { column: "current_score", needsRatingJoin: true };
        if (column === "averageScore") return { column: "current_average_score", needsRatingJoin: true };
        if (column === "place") return { column: "current_place", needsRatingJoin: true };
        const map: Record<string, string> = { code: "code", name: "name", active: "active" };
        return { column: map[column] ?? "name", needsRatingJoin: false };
    }

    private async attachExtras(row: { id: number; code: number; name: string; region_of_the_year_score: number | null; active: boolean; avatar_url: string | null }): Promise<Region> {
        const [ratingRows, districtCountRow, studentCountRow] = await Promise.all([
            pg
                .selectFrom("region_year_ratings")
                .select(["year", "score", "average_score", "place"])
                .where("region_id", "=", row.id)
                .orderBy("year")
                .execute(),
            pg
                .selectFrom("districts")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("region_id", "=", row.id)
                .executeTakeFirstOrThrow(),
            pg
                .selectFrom("students")
                .innerJoin("districts", "districts.id", "students.district_id")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("districts.region_id", "=", row.id)
                .executeTakeFirstOrThrow(),
        ]);

        return {
            id: row.id,
            code: row.code,
            name: row.name,
            regionOfTheYearScore: row.region_of_the_year_score,
            active: row.active,
            avatarUrl: row.avatar_url,
            districtCount: Number(districtCountRow.count),
            studentCount: Number(studentCountRow.count),
            ratings: ratingRows.map((r) => ({ year: r.year, score: r.score, averageScore: r.average_score, place: r.place })),
        };
    }
}

export const regionServicePg = new RegionServicePg();
