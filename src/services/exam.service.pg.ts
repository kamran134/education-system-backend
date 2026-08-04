import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { escapeRegex } from "../utils/validation.util";
import { CODE_LENGTHS } from "../utils/entity-codes.const";

export interface Exam {
    id: number;
    code: number;
    name: string;
    date: Date;
    active: boolean;
}

export interface ExamCreate {
    code: number;
    name: string;
    date: Date;
    active?: boolean;
}

/**
 * Postgres-версия ExamService — см. exam.service.ts (Mongo) для сравнения. Контракт методов
 * тот же, id — число (решение 04.08.2026, PG_MIGRATION_TASKS.md шаг 8).
 */
export class ExamServicePg {
    async findById(id: number): Promise<Exam | null> {
        const row = await pg.selectFrom("exams").selectAll().where("id", "=", id).executeTakeFirst();
        return row ?? null;
    }

    async findByCode(code: number): Promise<Exam | null> {
        const row = await pg.selectFrom("exams").selectAll().where("code", "=", code).executeTakeFirst();
        return row ?? null;
    }

    async create(data: ExamCreate): Promise<Exam> {
        return await pg
            .insertInto("exams")
            .values({ code: data.code, name: data.name, date: data.date, active: data.active ?? true })
            .returningAll()
            .executeTakeFirstOrThrow();
    }

    async update(id: number, data: Partial<ExamCreate>): Promise<Exam> {
        const row = await pg
            .updateTable("exams")
            .set({
                ...(data.code !== undefined && { code: data.code }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.date !== undefined && { date: data.date }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Exam not found");
        return row;
    }

    /**
     * Как и Mongo-версия: сначала удаляет все результаты экзаменов, затем сам экзамен.
     * studentResult.service.ts ещё не перенесён — прямой запрос к student_results
     * (тот же минимальный паттерн, что уже применён в student.service.pg.ts).
     */
    async delete(id: number): Promise<void> {
        await pg.transaction().execute(async (trx) => {
            await trx.deleteFrom("student_results").where("exam_id", "=", id).execute();
            const result = await trx.deleteFrom("exams").where("id", "=", id).executeTakeFirst();
            if (Number(result.numDeletedRows) === 0) throw new Error("Exam not found");
        });
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        for (const id of ids) {
            await this.delete(id);
        }
        return { insertedCount: 0, modifiedCount: 0, deletedCount: ids.length, errors: [] };
    }

    async getFilteredExams(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Exam[]; totalCount: number }> {
        const sortColumn = this.mapSortColumn(sort.sortColumn);
        const orderExpr = sortColumn === "name" ? sql`name COLLATE az_ci` : sql.ref(sortColumn);

        let query = this.applyFilter(pg.selectFrom("exams").selectAll(), filters);
        query = query.orderBy(orderExpr, sort.sortDirection) as typeof query;

        const [rows, countRow] = await Promise.all([
            query.limit(pagination.size).offset(pagination.skip).execute(),
            this.applyFilter(pg.selectFrom("exams"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        return { data: rows, totalCount: Number(countRow.count) };
    }

    async getExamsForFilter(filters: FilterOptionsPg): Promise<Exam[]> {
        return await this.applyFilter(pg.selectFrom("exams").selectAll(), filters)
            .orderBy("date", "desc")
            .execute();
    }

    async getExamsByMonthYear(month: number, year: number): Promise<Exam[]> {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 1));

        return await pg
            .selectFrom("exams")
            .selectAll()
            .where("date", ">=", startDate)
            .where("date", "<", endDate)
            .execute();
    }

    async processExamsFromExcel(filePath: string): Promise<FileProcessingResult<Exam>> {
        const processedData: Exam[] = [];
        const errors: string[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 4) {
                throw new Error("Invalid Excel file format");
            }

            const rows = data.slice(3);
            const dataToInsert = rows
                .map((row: any) => ({ code: Number(row[1]), name: String(row[2]), date: new Date(row[3]) }))
                .filter((d: any) => d.code > 0 && d.name && d.date);

            const existingCodes = await this.checkExistingExamCodes(dataToInsert.map((d: any) => d.code));
            const newExams = existingCodes.length > 0
                ? dataToInsert.filter((d: any) => !existingCodes.includes(d.code))
                : dataToInsert;

            if (newExams.length > 0) {
                const created = await pg
                    .insertInto("exams")
                    .values(newExams.map((e: any) => ({ code: e.code, name: e.name, date: e.date, active: true })))
                    .returningAll()
                    .execute();
                processedData.push(...created);
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

    async checkExistingExamCodes(codes: number[]): Promise<number[]> {
        if (codes.length === 0) return [];
        const rows = await pg.selectFrom("exams").select("code").where("code", "in", codes).execute();
        return rows.map((r) => r.code);
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, CODE_LENGTHS.EXAM);
            q = q.where("code", ">=", parseInt(start)).where("code", "<=", parseInt(end));
        }

        if (filters.active !== undefined) {
            q = q.where("active", "=", filters.active);
        }

        if (filters.search && filters.search.trim() !== "") {
            const term = filters.search.trim();
            if (/^\d+$/.test(term)) {
                const { start, end } = RequestParser.parseCodeRange(parseInt(term), 3);
                q = q.where("code", ">=", parseInt(start)).where("code", "<=", parseInt(end));
            } else {
                q = q.where(sql`name`, "ilike", `%${escapeRegex(term)}%`);
            }
        }

        // Год/месяц — как в Mongo-версии: месяц работает вместе с годом или отдельно
        // (год по умолчанию — текущий), dateFrom/dateTo — только если year/month не заданы.
        if (filters.year) {
            const year = parseInt(filters.year);
            if (!isNaN(year)) {
                if (filters.month) {
                    const month = parseInt(filters.month);
                    if (!isNaN(month) && month >= 1 && month <= 12) {
                        q = q.where("date", ">=", new Date(Date.UTC(year, month - 1, 1))).where("date", "<", new Date(Date.UTC(year, month, 1)));
                    }
                } else {
                    q = q.where("date", ">=", new Date(year, 0, 1)).where("date", "<", new Date(year + 1, 0, 1));
                }
            }
        } else if (filters.month) {
            const month = parseInt(filters.month);
            if (!isNaN(month) && month >= 1 && month <= 12) {
                const year = new Date().getUTCFullYear();
                q = q.where("date", ">=", new Date(Date.UTC(year, month - 1, 1))).where("date", "<", new Date(Date.UTC(year, month, 1)));
            }
        } else if (filters.dateFrom || filters.dateTo) {
            if (filters.dateFrom) q = q.where("date", ">=", new Date(filters.dateFrom));
            if (filters.dateTo) q = q.where("date", "<=", new Date(filters.dateTo));
        }

        return q;
    }

    private mapSortColumn(column: string): "code" | "name" | "date" | "active" {
        const map: Record<string, any> = { code: "code", name: "name", date: "date", active: "active" };
        return map[column] ?? "date";
    }
}

export const examServicePg = new ExamServicePg();
