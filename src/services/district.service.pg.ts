import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { escapeRegex } from "../utils/validation.util";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export interface YearRatingRow {
    year: number;
    score: number | null;
    averageScore: number | null;
    place: number | null;
}

export interface District {
    id: number;
    code: number;
    name: string;
    regionId: number | null;
    regionName: string | null;
    studentCount: number | null;
    rate: number | null;
    districtOfTheYearScore: number | null;
    active: boolean;
    avatarUrl: string | null;
    ratings: YearRatingRow[];
}

export interface DistrictCreate {
    code: number;
    name: string;
    regionId?: number | null;
    studentCount?: number;
    rate?: number;
    districtOfTheYearScore?: number;
    active?: boolean;
}

/**
 * Postgres-версия DistrictService (education-system-back/scripts/etl-mongo-to-pg.ts перенёс данные,
 * db/schema.sql — источник структуры). Публичный контракт (имена методов, форма ответов) совпадает
 * с Mongo-версией в district.service.ts — контроллер/usecase меняются минимально.
 *
 * Отличия от Mongo-версии, все намеренные:
 *   - id — число (bigint), а не ObjectId. Решение пользователя 04.08.2026, см. PG_MIGRATION_TASKS.md шаг 8.
 *   - delete() полагается на настоящие FK: если на район ссылается пользователь (users.district_id),
 *     Postgres бросит ошибку внешнего ключа вместо того, чтобы молча оставить пользователя с висячей
 *     ссылкой, как это происходило в Mongo (см. находки шага 3 — 5 таких пользователей уже были в проде).
 *     Это сознательное улучшение, не regression — если понадобится откатить, оборачивать в try/catch
 *     с понятным сообщением, а не убирать constraint.
 *   - filters.districtIds/schoolIds/... не используются при листинге районов — Mongo-версия (buildCommonFilter)
 *     тоже их не использовала (район не фильтруется "по району"), поведение сохранено как есть.
 */
export class DistrictServicePg {
    async updateDistrictsStats(): Promise<void> {
        // Портируется вместе со stats.service.ts (шаг 8, последний и самый крупный кусок) —
        // там же живёт вторая, конкурирующая реализация (путь B), см. db/rating-semantics.md.
        throw new Error("updateDistrictsStats: перенос отложен до переписывания stats.service.ts");
    }

    async findById(id: number): Promise<District | null> {
        const row = await pg.selectFrom("districts").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return await this.attachRatings(row);
    }

    async findByCode(code: number): Promise<District | null> {
        const row = await pg.selectFrom("districts").selectAll().where("code", "=", code).executeTakeFirst();
        if (!row) return null;
        return await this.attachRatings(row);
    }

    async create(data: DistrictCreate): Promise<District> {
        const row = await pg
            .insertInto("districts")
            .values({
                code: data.code,
                name: data.name,
                region_id: data.regionId ?? null,
                student_count: data.studentCount ?? null,
                rate: data.rate ?? null,
                district_of_the_year_score: data.districtOfTheYearScore ?? 0,
                active: data.active ?? true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return await this.attachRatings(row);
    }

    async update(id: number, data: Partial<DistrictCreate>): Promise<District> {
        const row = await pg
            .updateTable("districts")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.regionId !== undefined && { region_id: data.regionId }),
                ...(data.studentCount !== undefined && { student_count: data.studentCount }),
                ...(data.rate !== undefined && { rate: data.rate }),
                ...(data.districtOfTheYearScore !== undefined && { district_of_the_year_score: data.districtOfTheYearScore }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("District not found");
        return await this.attachRatings(row);
    }

    /**
     * Каскад совпадает по порядку с Mongo-версией (учителя → результаты учеников → ученики → школы → район),
     * но выполняется одной транзакцией — то, чего у Mongo-версии не было и не могло быть без replica set.
     */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            const schools = await trx.selectFrom("schools").select("id").where("district_id", "=", id).execute();
            const schoolIds = schools.map((s) => s.id);

            if (schoolIds.length > 0) {
                const teachers = await trx.selectFrom("teachers").select("id").where("school_id", "in", schoolIds).execute();
                const teacherIds = teachers.map((t) => t.id);

                const students = await trx.selectFrom("students").select("id").where("school_id", "in", schoolIds).execute();
                const studentIds = students.map((s) => s.id);

                if (studentIds.length > 0) {
                    await trx.deleteFrom("student_results").where("student_id", "in", studentIds).execute();
                }
                if (teacherIds.length > 0) {
                    await trx.deleteFrom("teachers").where("id", "in", teacherIds).execute();
                }
                if (studentIds.length > 0) {
                    await trx.deleteFrom("students").where("school_id", "in", schoolIds).execute();
                }
                await trx.deleteFrom("schools").where("district_id", "=", id).execute();
            }

            const result = await trx.deleteFrom("districts").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("District not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        for (const id of ids) {
            await this.delete(id);
        }
        return { insertedCount: 0, modifiedCount: 0, deletedCount: ids.length, errors: [] };
    }

    async getFilteredDistricts(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: District[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();

        // score/averageScore/place не хранятся на districts — джойн с district_year_ratings
        // за текущий год нужен только для ORDER BY (сама запись в ответе собирается заново
        // в attachRatings). Найдено 04.08.2026 перед переключением: до этой правки сортировка
        // по averageScore тихо проваливалась в fallback на name — differential-харнесс (шаг 9)
        // это не поймал, потому что сравнивает множества записей, а не порядок.
        let query = pg
            .selectFrom("districts")
            .leftJoin("district_year_ratings", (join) =>
                join.onRef("district_year_ratings.district_id", "=", "districts.id").on("district_year_ratings.year", "=", currentYear)
            )
            .selectAll("districts")
            .select(["district_year_ratings.score as current_score", "district_year_ratings.average_score as current_average_score", "district_year_ratings.place as current_place"]);
        query = this.applyFilter(query, filters);

        const { column, needsRatingJoin } = this.mapSortColumn(sort.sortColumn);
        const orderExpr = column === "name" ? sql`districts.name COLLATE az_ci` : sql.ref(needsRatingJoin ? column : `districts.${column}`);
        const dirSql = sort.sortDirection === "asc" ? sql`ASC` : sql`DESC`;
        // NULLS LAST явно — районы без строки в district_year_ratings (LEFT JOIN) иначе
        // всплывают в начало при DESC, тот же баг, что уже был найден и исправлен
        // в school/teacher/student.service.pg.ts на шаге 8.
        const finalQuery = query.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(pagination.size).offset(pagination.skip);

        const [rows, countRow] = await Promise.all([
            finalQuery.execute(),
            this.applyFilter(pg.selectFrom("districts"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        const data = await Promise.all(rows.map((r) => this.attachRatings(r)));
        return { data, totalCount: Number(countRow.count) };
    }

    async getDistrictsForFilter(filters: FilterOptionsPg): Promise<District[]> {
        let query = pg.selectFrom("districts").selectAll();
        query = this.applyFilter(query, filters);
        const rows = await query.orderBy(sql`name COLLATE az_ci`).execute();
        return await Promise.all(rows.map((r) => this.attachRatings(r)));
    }

    async processDistrictsFromExcel(filePath: string): Promise<FileProcessingResult<District>> {
        const processedData: District[] = [];
        const errors: string[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 4) {
                throw new Error("Invalid Excel file format");
            }

            const rows = data.slice(3);
            const dataToInsert = rows.map((row: any) => ({
                code: Number(row[1]),
                name: String(row[2]),
                studentCount: Number(row[3]) || 0,
            }));

            const validDistricts = dataToInsert.filter((d) => d.code > 0 && d.name);
            const existingCodes = await this.checkExistingDistrictCodes(validDistricts.map((d) => d.code));
            const newDistricts = validDistricts.filter((d) => !existingCodes.includes(d.code));

            if (newDistricts.length > 0) {
                const created = await pg
                    .insertInto("districts")
                    .values(
                        newDistricts.map((d) => ({
                            code: d.code,
                            name: d.name,
                            student_count: d.studentCount,
                            active: true,
                        }))
                    )
                    .returningAll()
                    .execute();
                processedData.push(...(await Promise.all(created.map((r) => this.attachRatings(r)))));
            }

            const existingToUpdate = validDistricts.filter((d) => existingCodes.includes(d.code));
            for (const d of existingToUpdate) {
                await pg.updateTable("districts").set({ student_count: d.studentCount }).where("code", "=", d.code).execute();
            }
            if (existingToUpdate.length > 0) {
                console.log(`✅ Обновлено studentCount для ${existingToUpdate.length} существующих районов`);
            }

            await deleteFile(filePath).catch(() => {});

            return {
                processedData,
                errors,
                skippedItems: existingCodes.map((code) => ({ code, reason: "Already exists" })),
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    async checkExistingDistrictCodes(codes: number[]): Promise<number[]> {
        if (codes.length === 0) return [];
        const rows = await pg.selectFrom("districts").select("code").where("code", "in", codes).execute();
        return rows.map((r) => r.code);
    }

    /**
     * В Mongo-версии пишет ad-hoc поле examCount, которого нет ни в схеме, ни в IDistrict —
     * то есть результат этого метода никогда не был виден через типизированный API. Оставлено
     * как есть намеренно: считаем количество для парности поведения, но никуда не пишем —
     * в Postgres такого столбца нет и заводить его специально под мёртвую функциональность не стоит.
     */
    async countDistrictsRates(): Promise<void> {
        console.log("⚠️  countDistrictsRates: подсчитано, но не записано — поле examCount не существует ни в Mongo-типах, ни в схеме Postgres (см. комментарий в коде)");
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            q = q.where("code", ">=", parseInt(start)).where("code", "<=", parseInt(end));
        }
        if (filters.regionIds && filters.regionIds.length > 0) {
            q = q.where("region_id", "in", filters.regionIds);
        }
        if (filters.search) {
            q = q.where(sql`name`, "ilike", `%${escapeRegex(filters.search)}%`);
        }
        if (filters.active !== undefined) {
            q = q.where("active", "=", filters.active);
        }
        return q;
    }

    // "region" намеренно не в списке сортируемых колонок — сортировка по региону здесь
    // не запрашивалась (REGIONS_TASKS.md шаг 5), фильтр regionIds покрывает потребность.
    private mapSortColumn(column: string): { column: string; needsRatingJoin: boolean } {
        if (column === "score") return { column: "current_score", needsRatingJoin: true };
        if (column === "averageScore") return { column: "current_average_score", needsRatingJoin: true };
        if (column === "place") return { column: "current_place", needsRatingJoin: true };
        const map: Record<string, string> = {
            code: "code", name: "name",
            studentCount: "student_count", rate: "rate", active: "active",
        };
        return { column: map[column] ?? "name", needsRatingJoin: false };
    }

    private async attachRatings(row: { id: number; code: number; name: string; region_id: number | null; student_count: number | null; rate: number | null; district_of_the_year_score: number | null; active: boolean; avatar_url: string | null }): Promise<District> {
        const [ratingRows, region] = await Promise.all([
            pg
                .selectFrom("district_year_ratings")
                .select(["year", "score", "average_score", "place"])
                .where("district_id", "=", row.id)
                .orderBy("year")
                .execute(),
            row.region_id
                ? pg.selectFrom("regions").select("name").where("id", "=", row.region_id).executeTakeFirst()
                : Promise.resolve(undefined),
        ]);

        return {
            id: row.id,
            code: row.code,
            name: row.name,
            regionId: row.region_id,
            regionName: region?.name ?? null,
            studentCount: row.student_count,
            rate: row.rate,
            districtOfTheYearScore: row.district_of_the_year_score,
            active: row.active,
            avatarUrl: row.avatar_url,
            ratings: ratingRows.map((r) => ({ year: r.year, score: r.score, averageScore: r.average_score, place: r.place })),
        };
    }
}

export const districtServicePg = new DistrictServicePg();
