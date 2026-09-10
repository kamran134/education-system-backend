import { pg } from "../config/pg";
import xlsx from "xlsx";
import fs from "fs";
import { PaginationOptions, SortOptions } from "../types/common.types";
import { deleteFile } from "./file.service";
import { Json } from "../types/db";

const MAX_BOOKLET_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Reads an Excel file and returns rows as arrays of display (formatted) values. */
const readBookletExcel = (filePath: string): any[][] => {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BOOKLET_SIZE_BYTES) {
        throw new Error(`Fayl çox böyükdür: maksimum 50 MB icazə verilir`);
    }
    const workbook = xlsx.readFile(filePath, {
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        sheetStubs: false,
    });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: null });
};

// Record<string, string[]> вместо пяти захардкоженных ключей (IMTAHAN_NOVLERI_TASK.md §6) —
// произвольный набор кодов предметов, а не только az/math/lifeKnowledge/logic/english.
// parseAndUpsertFromExcel ниже пока опознаёт заголовки тем же эвристическим способом (см.
// комментарий там), поэтому на практике заполняются только эти пять — но тип больше не
// ограничивает это искусственно, и валидация идёт по набору предметов СЕКЦИИ экзамена (§5 ТЗ),
// а не по всему справочнику subjects.
export type BookletDisciplines = Record<string, string[]>;

export interface BookletExamRef {
    id: number;
    name: string;
    date: Date;
}

export interface BookletDistrictRef {
    id: number;
    code: number;
    name: string;
}

export interface Booklet {
    id: number;
    examId: number;
    districtId: number | null;
    variant: string;
    grade: number;
    disciplines: BookletDisciplines;
    name: string | null;
    exam?: BookletExamRef;
    district?: BookletDistrictRef | null;
    // IMTAHAN_NOVLERI_TASK.md §5 "хвост шага 2": subjects.name_az по кодам-ключам disciplines,
    // JOIN'ом на сервере — страница буклета публична (без JWT), GET /subjects требует
    // authMiddleware([]), поэтому клиент не может подтянуть названия сам. Раньше фронт держал
    // локальный словарь пяти известных кодов с фоллбэком на код — для нового предмета показывался
    // код вместо названия. Ключ, которого нет в subjects (не должно случаться, но не гарантировано
    // FK — disciplines это Json), просто отсутствует в карте; клиент фоллбэкает на сам код.
    disciplineNames: Record<string, string>;
}

export interface BookletCreate {
    examId: number;
    variant: string;
    grade: number;
    disciplines: BookletDisciplines;
    districtId?: number | null;
    name?: string | null;
}

export interface BookletFilterOptionsPg {
    examId?: number;
    districtId?: number;
    variant?: string;
    grade?: number;
}

/**
 * Postgres-версия BookletService — см. booklet.service.ts (Mongo) для сравнения.
 * `.populate("exam")`/`.populate("district")` заменены батч-джойнами (как в school/teacher.service.pg.ts) —
 * один доп. запрос на весь результат, не N+1 на строку.
 *
 * **Осознанное отличие:** upsert по `(exam, variant, grade)` в Mongo не защищён уникальным индексом
 * (в модели его никогда не было — см. booklet.model.ts) и db/schema.sql это не меняет: constraint
 * заводить не стали, раз он не был частью исходного контракта. Поэтому `upsert()` здесь — тот же
 * select-затем-insert/update, что и `findOneAndUpdate`, а не `ON CONFLICT` (нет уникального индекса,
 * на который его можно нацелить).
 */
export class BookletServicePg {
    async findById(id: number): Promise<Booklet | null> {
        const row = await pg.selectFrom("booklets").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return (await this.attachRefs([row]))[0];
    }

    async findOne(filters: BookletFilterOptionsPg): Promise<Booklet | null> {
        const row = await this.applyFilter(pg.selectFrom("booklets").selectAll(), filters).executeTakeFirst();
        if (!row) return null;
        return (await this.attachRefs([row]))[0];
    }

    async create(data: BookletCreate): Promise<Booklet> {
        const row = await pg
            .insertInto("booklets")
            .values({
                exam_id: data.examId,
                district_id: data.districtId ?? null,
                variant: data.variant,
                grade: data.grade,
                disciplines: data.disciplines as unknown as Json,
                name: data.name ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return (await this.attachRefs([row]))[0];
    }

    async update(id: number, data: Partial<BookletCreate>): Promise<Booklet> {
        const row = await pg
            .updateTable("booklets")
            .set({
                ...(data.examId !== undefined && { exam_id: data.examId }),
                ...(data.districtId !== undefined && { district_id: data.districtId }),
                ...(data.variant !== undefined && { variant: data.variant }),
                ...(data.grade !== undefined && { grade: data.grade }),
                ...(data.disciplines !== undefined && { disciplines: data.disciplines as unknown as Json }),
                ...(data.name !== undefined && { name: data.name }),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Booklet not found");
        return (await this.attachRefs([row]))[0];
    }

    async delete(id: number): Promise<void> {
        const result = await pg.deleteFrom("booklets").where("id", "=", id).executeTakeFirst();
        if (Number(result.numDeletedRows) === 0) throw new Error("Booklet not found");
    }

    /** См. комментарий класса — select-затем-insert/update, не ON CONFLICT (нет уникального индекса). */
    async upsert(
        examId: number,
        variant: string,
        grade: number,
        disciplines: BookletDisciplines,
        districtId?: number,
        name?: string
    ): Promise<Booklet> {
        const existing = await pg
            .selectFrom("booklets")
            .select("id")
            .where("exam_id", "=", examId)
            .where("variant", "=", variant)
            .where("grade", "=", grade)
            .executeTakeFirst();

        if (existing) {
            return await this.update(existing.id, { examId, variant, grade, disciplines, districtId, name });
        }
        return await this.create({ examId, variant, grade, disciplines, districtId, name });
    }

    /**
     * Excel structure — см. комментарий в booklet.service.ts (Mongo-версия), логика парсинга не менялась.
     */
    async parseAndUpsertFromExcel(filePath: string, examId: number): Promise<{ processedCount: number; errors: string[] }> {
        const errors: string[] = [];

        try {
            const rows: any[][] = readBookletExcel(filePath);

            if (rows.length < 4) {
                throw new Error("Fayl düzgün formatda deyil: minimum 4 sətir lazımdır");
            }

            const row1: any[] = Array.isArray(rows[0]) ? rows[0] : [];
            if (row1.length < 2) {
                throw new Error("Fayl düzgün formatda deyil: 1-ci sətirdə ən azı 2 sütun olmalıdır (A1, B1)");
            }
            const districtCodeRaw = row1[1];
            const bookletName = String(row1[3] ?? "").trim() || undefined;

            let districtId: number | undefined;
            if (districtCodeRaw != null && String(districtCodeRaw).trim() !== "") {
                const districtCode = Number(String(districtCodeRaw).trim());
                if (isNaN(districtCode)) {
                    throw new Error(`B1 xanasındakı rayon kodu düzgün deyil: "${districtCodeRaw}"`);
                }
                const district = await pg.selectFrom("districts").select("id").where("code", "=", districtCode).executeTakeFirst();
                if (!district) {
                    throw new Error(`${districtCode} kodlu rayon tapılmadı`);
                }
                districtId = district.id;
            }

            const headerRow: any[] = Array.isArray(rows[2]) ? rows[2] : [];
            const dataRows: any[][] = rows.slice(3);

            if (dataRows.length === 0 || !Array.isArray(dataRows[0])) {
                throw new Error("Fayl düzgün formatda deyil: 4-cü sətirdən başlayaraq məlumat sırları olmalıdır");
            }

            let variantColIdx = 0;
            let gradeColIdx = 1;
            const colMap: Record<string, number> = {};

            headerRow.forEach((cell: any, idx: number) => {
                if (cell == null) return;
                const normalized = String(cell).trim().toLowerCase();

                if (normalized.includes("variant")) variantColIdx = idx;
                else if (normalized.includes("sinif") || normalized.includes("klas")) gradeColIdx = idx;
                else if (normalized.includes("azərb")) colMap.az = idx;
                else if (normalized.includes("riyaz")) colMap.math = idx;
                else if (normalized.includes("həyat")) colMap.lifeKnowledge = idx;
                else if (normalized.includes("məntiq")) colMap.logic = idx;
                else if (normalized.includes("ingilis")) colMap.english = idx;
            });

            if (Object.keys(colMap).length === 0) {
                throw new Error("Fayl başlıqlarında fənn sütunları tapilmadı");
            }

            const firstRow = dataRows[0];
            const variant = String(firstRow?.[variantColIdx] ?? "").trim();
            const grade = Number(String(firstRow?.[gradeColIdx] ?? "").trim());

            if (!variant) throw new Error(`Variant tapılmadı (sətir 4, sütun indeks ${variantColIdx})`);
            if (!grade || isNaN(grade)) throw new Error(`Sinif tapılmadı (sətir 4, sütun indeks ${gradeColIdx})`);

            const disciplines: BookletDisciplines = {};
            for (const [field, colIdx] of Object.entries(colMap)) {
                const answers: string[] = dataRows
                    .map((row) => String(row[colIdx] ?? "").trim())
                    .filter((val) => val !== "" && val !== "null");

                if (answers.length > 0) {
                    disciplines[field] = answers;
                }
            }

            // Валидация по набору предметов СЕКЦИИ экзамена, а не по всему справочнику subjects
            // (IMTAHAN_NOVLERI_TASK.md §5): буклет "5-11 sinif" с ключом "az" должен падать,
            // если у секции этого экзамена/класса "az" не настроен — до 023_exam_types_and_
            // level_scales.sql такой проверки не было вовсе (только глобальный триггер БД
            // validate_booklet_disciplines_keys, который знает только про существование кода
            // предмета, а не про его принадлежность конкретной секции).
            const disciplineKeys = Object.keys(disciplines);
            if (disciplineKeys.length > 0) {
                const exam = await pg.selectFrom("exams").select("exam_type_id").where("id", "=", examId).executeTakeFirst();
                if (exam) {
                    const section = await pg
                        .selectFrom("exam_type_sections")
                        .select("id")
                        .where("exam_type_id", "=", exam.exam_type_id)
                        .where("grade_from", "<=", grade)
                        .where("grade_to", ">=", grade)
                        .executeTakeFirst();

                    const allowedCodes = section
                        ? new Set(
                              (
                                  await pg
                                      .selectFrom("exam_type_section_subjects")
                                      .select("subject_code")
                                      .where("section_id", "=", section.id)
                                      .execute()
                              ).map((r) => r.subject_code)
                          )
                        : new Set<string>();

                    if (allowedCodes.size === 0) {
                        throw new Error("Bu sinif qrupu üçün fənlər təyin edilməyib");
                    }
                    const unknownKey = disciplineKeys.find((k) => !allowedCodes.has(k));
                    if (unknownKey) {
                        throw new Error(`"${unknownKey}" fənni bu sinif üçün bölmənin tərkibinə daxil deyil`);
                    }
                }
            }

            await this.upsert(examId, variant, grade, disciplines, districtId, bookletName);

            return { processedCount: 1, errors };
        } finally {
            await deleteFile(filePath).catch(() => {});
        }
    }

    async getFiltered(
        pagination: PaginationOptions,
        filters: BookletFilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Booklet[]; totalCount: number }> {
        const sortColumn = this.mapSortColumn(sort.sortColumn);

        let query = this.applyFilter(pg.selectFrom("booklets").selectAll(), filters);
        query = query.orderBy(sortColumn, sort.sortDirection) as typeof query;

        const [rows, countRow] = await Promise.all([
            query.limit(pagination.size).offset(pagination.skip).execute(),
            this.applyFilter(pg.selectFrom("booklets"), filters)
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        return { data: await this.attachRefs(rows), totalCount: Number(countRow.count) };
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: BookletFilterOptionsPg): Q {
        let q = query;
        if (filters.examId !== undefined) q = q.where("exam_id", "=", filters.examId);
        if (filters.districtId !== undefined) q = q.where("district_id", "=", filters.districtId);
        if (filters.variant !== undefined) q = q.where("variant", "=", filters.variant);
        if (filters.grade !== undefined) q = q.where("grade", "=", filters.grade);
        return q;
    }

    private mapSortColumn(column: string): "variant" | "grade" | "name" {
        const map: Record<string, any> = { variant: "variant", grade: "grade", name: "name" };
        return map[column] ?? "grade";
    }

    private async attachRefs(rows: {
        id: number; exam_id: number; district_id: number | null; variant: string; grade: number;
        disciplines: Json; name: string | null;
    }[]): Promise<Booklet[]> {
        const examIds = [...new Set(rows.map((r) => r.exam_id))];
        const districtIds = [...new Set(rows.map((r) => r.district_id).filter((id): id is number => id != null))];
        // Ключи disciplines — коды предметов (az/math/... или новые, из справочника subjects).
        const subjectCodes = [...new Set(rows.flatMap((r) => Object.keys((r.disciplines as unknown as BookletDisciplines) ?? {})))];

        const [exams, districts, subjects] = await Promise.all([
            examIds.length > 0
                ? pg.selectFrom("exams").select(["id", "name", "date"]).where("id", "in", examIds).execute()
                : Promise.resolve([]),
            districtIds.length > 0
                ? pg.selectFrom("districts").select(["id", "code", "name"]).where("id", "in", districtIds).execute()
                : Promise.resolve([]),
            subjectCodes.length > 0
                ? pg.selectFrom("subjects").select(["code", "name_az"]).where("code", "in", subjectCodes).execute()
                : Promise.resolve([]),
        ]);

        const examById = new Map(exams.map((e) => [e.id, e]));
        const districtById = new Map(districts.map((d) => [d.id, d]));
        const subjectNameByCode = new Map(subjects.map((s) => [s.code, s.name_az]));

        return rows.map((row) => {
            const disciplines = row.disciplines as unknown as BookletDisciplines;
            const disciplineNames: Record<string, string> = {};
            for (const code of Object.keys(disciplines ?? {})) {
                const nameAz = subjectNameByCode.get(code);
                if (nameAz) disciplineNames[code] = nameAz;
            }
            return {
                id: row.id,
                examId: row.exam_id,
                districtId: row.district_id,
                variant: row.variant,
                grade: row.grade,
                disciplines,
                name: row.name,
                exam: examById.get(row.exam_id),
                district: row.district_id != null ? districtById.get(row.district_id) ?? null : null,
                disciplineNames,
            };
        });
    }
}

export const bookletServicePg = new BookletServicePg();
