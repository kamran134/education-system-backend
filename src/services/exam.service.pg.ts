import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { escapeRegex } from "../utils/validation.util";

export interface Exam {
    id: number;
    name: string;
    date: Date;
    active: boolean;
    examTypeId: number;
    examTypeName: string;
}

export interface ExamCreate {
    name: string;
    date: Date;
    active?: boolean;
    examTypeId: number;
}

/**
 * Postgres-версия ExamService — см. exam.service.ts (Mongo) для сравнения. Контракт методов
 * тот же, id — число (решение 04.08.2026, PG_MIGRATION_TASKS.md шаг 8).
 */
export class ExamServicePg {
    /**
     * exam_type_id стал обязательным (023_exam_types_and_level_scales.sql), а camelCase-поля
     * Exam/ExamCreate до сих пор молча совпадали с snake_case только потому, что у прежних
     * полей (code/name/date/active) имена буква-в-букву одинаковы. Для exam_type_id/exam_type_name
     * это уже не так — отсюда явный JOIN + маппер вместо selectAll().
     */
    private baseSelect() {
        return pg
            .selectFrom("exams as e")
            .innerJoin("exam_types as et", "et.id", "e.exam_type_id")
            .select([
                "e.id", "e.name", "e.date", "e.active",
                "e.exam_type_id", "et.name_az as exam_type_name",
            ]);
    }

    private mapRow(row: {
        id: number; name: string; date: Date; active: boolean;
        exam_type_id: number; exam_type_name: string;
    }): Exam {
        return {
            id: row.id, name: row.name, date: row.date, active: row.active,
            examTypeId: row.exam_type_id, examTypeName: row.exam_type_name,
        };
    }

    async findById(id: number): Promise<Exam | null> {
        const row = await this.baseSelect().where("e.id", "=", id).executeTakeFirst();
        return row ? this.mapRow(row) : null;
    }

    async create(data: ExamCreate): Promise<Exam> {
        const inserted = await pg
            .insertInto("exams")
            .values({
                name: data.name, date: data.date, active: data.active ?? true,
                exam_type_id: data.examTypeId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

        const exam = await this.findById(inserted.id);
        if (!exam) throw new Error("Exam not found immediately after insert — this is a bug");
        return exam;
    }

    async update(id: number, data: Partial<ExamCreate>): Promise<Exam> {
        // Смена exam_type_id у экзамена, у которого уже есть результаты, запрещена —
        // иначе результаты остаются привязаны к типу, набор предметов/шкала которого им
        // больше не соответствуют (IMTAHAN_NOVLERI_TASK.md §5, exam.service.pg.ts).
        if (data.examTypeId !== undefined) {
            const current = await this.findById(id);
            if (!current) throw new Error("Exam not found");

            if (data.examTypeId !== current.examTypeId) {
                const hasResults = await pg
                    .selectFrom("student_results")
                    .select(({ fn }) => [fn.countAll().as("count")])
                    .where("exam_id", "=", id)
                    .executeTakeFirstOrThrow();
                if (Number(hasResults.count) > 0) {
                    const err: any = new Error("Bu imtahanın artıq nəticələri var — növünü dəyişmək olmaz");
                    err.status = 409;
                    throw err;
                }
            }
        }

        await pg
            .updateTable("exams")
            .set({
                ...(data.name !== undefined && { name: data.name }),
                ...(data.date !== undefined && { date: data.date }),
                ...(data.active !== undefined && { active: data.active }),
                ...(data.examTypeId !== undefined && { exam_type_id: data.examTypeId }),
            })
            .where("id", "=", id)
            .execute();

        const row = await this.findById(id);
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
        const orderExpr = sortColumn === "e.name" ? sql`e.name COLLATE az_ci` : sql.ref(sortColumn);

        let query = this.applyFilter(this.baseSelect(), filters);
        query = query.orderBy(orderExpr, sort.sortDirection) as typeof query;

        // Count не обязан идти через JOIN на exam_types (считает только количество), но
        // applyFilter теперь ожидает алиас "e." — держим его и здесь, JOIN'а не делая.
        const [rows, countRow] = await Promise.all([
            query.limit(pagination.size).offset(pagination.skip).execute(),
            this.applyFilter(pg.selectFrom("exams as e"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        return { data: rows.map((r) => this.mapRow(r)), totalCount: Number(countRow.count) };
    }

    async getExamsForFilter(filters: FilterOptionsPg): Promise<Exam[]> {
        const rows = await this.applyFilter(this.baseSelect(), filters)
            .orderBy("e.date", "desc")
            .execute();
        return rows.map((r) => this.mapRow(r));
    }

    async getExamsByMonthYear(month: number, year: number): Promise<Exam[]> {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 1));

        const rows = await this.baseSelect()
            .where("e.date", ">=", startDate)
            .where("e.date", "<", endDate)
            .execute();
        return rows.map((r) => this.mapRow(r));
    }

    /**
     * Импорт СПИСКА экзаменов из Excel (не результатов) — самостоятельный путь, отдельный от
     * основного создания экзамена через POST /exams. exam_type_id стал NOT NULL после
     * 023_exam_types_and_level_scales.sql, поэтому вставка без него упадёт на уровне БД;
     * ТЗ шага 1 этот путь явно не упоминает, но чинить обязательно — иначе мина для прод-миграции.
     * Подставляем тот же базовый тип, что и сама миграция (is_base = true), одним запросом
     * перед циклом вставки — минимальное исправление, не меняющее видимое поведение эндпоинта.
     */
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
                .map((row: any) => ({ name: String(row[2]), date: new Date(row[3]) }))
                .filter((d: any) => d.name && d.date);

            // Ключа идемпотентности "code" больше нет (IMTAHAN_KODU_TASK.md §5) — дедуп по
            // (name, date), той же паре, что теперь несёт UNIQUE на exams. Метод не смонтирован
            // ни на один роут (см. комментарий класса выше), поэтому полная выборка exams
            // для сверки в памяти — минимальная правка, не переусложняем мёртвый путь.
            const existingExams = await pg.selectFrom("exams").select(["name", "date"]).execute();
            const existingKeys = new Set(existingExams.map((e) => `${e.name}|${e.date.toISOString()}`));

            const newExams = dataToInsert.filter((d: any) => !existingKeys.has(`${d.name}|${d.date.toISOString()}`));
            const skipped = dataToInsert.filter((d: any) => existingKeys.has(`${d.name}|${d.date.toISOString()}`));

            if (newExams.length > 0) {
                const baseType = await pg
                    .selectFrom("exam_types")
                    .select("id")
                    .where("is_base", "=", true)
                    .executeTakeFirstOrThrow();

                const inserted = await pg
                    .insertInto("exams")
                    .values(newExams.map((e: any) => ({
                        name: e.name, date: e.date, active: true,
                        exam_type_id: baseType.id,
                    })))
                    .returning(["id"])
                    .execute();

                const created = await Promise.all(inserted.map((r) => this.findById(r.id)));
                processedData.push(...(created.filter((e): e is Exam => e !== null)));
            }

            await deleteFile(filePath).catch(() => {});

            return {
                processedData,
                errors,
                skippedItems: skipped.map((d) => ({ name: d.name, date: d.date, reason: "Already exists" })),
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: FilterOptionsPg): Q {
        let q = query;

        if (filters.active !== undefined) {
            q = q.where("e.active", "=", filters.active);
        }

        if (filters.search && filters.search.trim() !== "") {
            const term = filters.search.trim();
            q = q.where(sql`e.name`, "ilike", `%${escapeRegex(term)}%`);
        }

        // Год/месяц — как в Mongo-версии: месяц работает вместе с годом или отдельно
        // (год по умолчанию — текущий), dateFrom/dateTo — только если year/month не заданы.
        if (filters.year) {
            const year = parseInt(filters.year);
            if (!isNaN(year)) {
                if (filters.month) {
                    const month = parseInt(filters.month);
                    if (!isNaN(month) && month >= 1 && month <= 12) {
                        q = q.where("e.date", ">=", new Date(Date.UTC(year, month - 1, 1))).where("e.date", "<", new Date(Date.UTC(year, month, 1)));
                    }
                } else {
                    q = q.where("e.date", ">=", new Date(year, 0, 1)).where("e.date", "<", new Date(year + 1, 0, 1));
                }
            }
        } else if (filters.month) {
            const month = parseInt(filters.month);
            if (!isNaN(month) && month >= 1 && month <= 12) {
                const year = new Date().getUTCFullYear();
                q = q.where("e.date", ">=", new Date(Date.UTC(year, month - 1, 1))).where("e.date", "<", new Date(Date.UTC(year, month, 1)));
            }
        } else if (filters.dateFrom || filters.dateTo) {
            if (filters.dateFrom) q = q.where("e.date", ">=", new Date(filters.dateFrom));
            if (filters.dateTo) q = q.where("e.date", "<=", new Date(filters.dateTo));
        }

        return q;
    }

    private mapSortColumn(column: string): "e.name" | "e.date" | "e.active" {
        const map: Record<string, any> = { name: "e.name", date: "e.date", active: "e.active" };
        return map[column] ?? "e.date";
    }
}

export const examServicePg = new ExamServicePg();
