import { sql, Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";

export interface ExamTypeSectionSubjectInput {
    subjectCode: string;
    sortOrder?: number;
}

export interface ExamTypeSectionInput {
    id?: number; // есть при обновлении существующей секции, отсутствует у новой
    nameAz: string;
    gradeFrom: number;
    gradeTo: number;
    subjects: ExamTypeSectionSubjectInput[];
}

export interface ExamTypeInput {
    code: string;
    nameAz: string;
    levelScaleId: number;
    monthAwardMinRank?: number | null;
    isBase?: boolean;
    active?: boolean;
    sortOrder?: number;
    sections: ExamTypeSectionInput[];
}

export interface ExamTypeSectionSubjectRow {
    subjectCode: string;
    nameAz: string; // из subjects.name_az, JOIN — фронту сразу нужно название, не только код
    sortOrder: number;
}

export interface ExamTypeSectionRow {
    id: number;
    nameAz: string;
    gradeFrom: number;
    gradeTo: number;
    subjects: ExamTypeSectionSubjectRow[];
}

export interface ExamTypeRow {
    id: number;
    code: string;
    nameAz: string;
    levelScaleId: number;
    monthAwardMinRank: number | null;
    isBase: boolean;
    active: boolean;
    sortOrder: number;
    /** Exams of this type — the list shows it and hides "delete" when > 0 (delete() refuses anyway). */
    examCount: number;
    sections: ExamTypeSectionRow[];
}

/**
 * CRUD типов экзаменов, их секций и наборов предметов (IMTAHAN_NOVLERI_TASK.md §5). Отдаёт
 * «дерево» типа целиком (тип → секции → предметы) — фронту нужно именно так.
 */
export class ExamTypeServicePg {
    /** Все типы (включая неактивные), с вложенными секциями и предметами. */
    async findAll(): Promise<ExamTypeRow[]> {
        const [typeRows, sectionRows, subjectRows, examCounts] = await Promise.all([
            pg
                .selectFrom("exam_types")
                .select([
                    "id", "code", "name_az", "level_scale_id",
                    "month_award_min_rank", "is_base", "active", "sort_order",
                ])
                .orderBy("sort_order", "asc")
                // Equal sort_order (all 0 by default): base type first, then creation order.
                .orderBy("is_base", "desc")
                .orderBy("id", "asc")
                .execute(),
            pg
                .selectFrom("exam_type_sections")
                .select(["id", "exam_type_id", "name_az", "grade_from", "grade_to"])
                .orderBy("grade_from", "asc")
                .execute(),
            pg
                .selectFrom("exam_type_section_subjects as ss")
                .innerJoin("subjects as s", "s.code", "ss.subject_code")
                .select(["ss.section_id", "ss.subject_code", "s.name_az as name_az", "ss.sort_order"])
                .orderBy("ss.sort_order", "asc")
                .execute(),
            pg
                .selectFrom("exams")
                .select(({ fn }) => ["exam_type_id", fn.countAll().as("count")])
                .groupBy("exam_type_id")
                .execute(),
        ]);
        const examCountByType = new Map(examCounts.map((r) => [r.exam_type_id, Number(r.count)]));

        return typeRows.map((t) => ({
            id: t.id,
            code: t.code,
            nameAz: t.name_az,
            levelScaleId: t.level_scale_id,
            monthAwardMinRank: t.month_award_min_rank,
            isBase: t.is_base,
            active: t.active,
            sortOrder: t.sort_order,
            examCount: examCountByType.get(t.id) ?? 0,
            sections: sectionRows
                .filter((sec) => sec.exam_type_id === t.id)
                .map((sec) => ({
                    id: sec.id,
                    nameAz: sec.name_az,
                    gradeFrom: sec.grade_from,
                    gradeTo: sec.grade_to,
                    subjects: subjectRows
                        .filter((sub) => sub.section_id === sec.id)
                        .map((sub) => ({
                            subjectCode: sub.subject_code,
                            nameAz: sub.name_az,
                            sortOrder: sub.sort_order,
                        })),
                })),
        }));
    }

    async findById(id: number): Promise<ExamTypeRow | null> {
        const all = await this.findAll();
        return all.find((t) => t.id === id) ?? null;
    }

    async create(data: ExamTypeInput): Promise<ExamTypeRow> {
        try {
            const id = await pg.transaction().execute(async (trx) => {
                const inserted = await trx
                    .insertInto("exam_types")
                    .values({
                        code: data.code,
                        name_az: data.nameAz,
                        level_scale_id: data.levelScaleId,
                        month_award_min_rank: data.monthAwardMinRank ?? null,
                        is_base: data.isBase ?? false,
                        active: data.active ?? true,
                        sort_order: data.sortOrder ?? 0,
                    })
                    .returning(["id"])
                    .executeTakeFirstOrThrow();

                await this.insertSections(trx, inserted.id, data.sections);
                return inserted.id;
            });

            return (await this.findById(id))!;
        } catch (e: any) {
            throw mapExamTypeDbError(e);
        }
    }

    async update(id: number, data: ExamTypeInput): Promise<ExamTypeRow> {
        try {
            await pg.transaction().execute(async (trx) => {
                const current = await trx
                    .selectFrom("exam_types")
                    .select(["level_scale_id", "is_base"])
                    .where("id", "=", id)
                    .executeTakeFirst();
                if (!current) {
                    const err: any = new Error("İmtahan növü tapılmadı");
                    err.status = 404;
                    throw err;
                }

                // Базовый тип нельзя перестать быть базовым. Частичный уникальный индекс
                // exam_types_single_base запрещает ДВА базовых типа, но ноль базовых типов не
                // запрещает ничем — а через is_base = true все существующие экраны рейтингов
                // резолвят свои данные (/stats/* без examTypeId, IMTAHAN_NOVLERI_TASK.md §5.3).
                // Один PUT без поля isBase молча погасил бы их все.
                if (current.is_base && !data.isBase) {
                    const err: any = new Error("Əsas imtahan növünün statusunu ləğv etmək olmaz");
                    err.status = 409;
                    throw err;
                }

                if (data.levelScaleId !== current.level_scale_id) {
                    await this.assertLevelScaleChangeAllowed(trx, id, data.levelScaleId);
                }

                await trx
                    .updateTable("exam_types")
                    .set({
                        code: data.code,
                        name_az: data.nameAz,
                        level_scale_id: data.levelScaleId,
                        month_award_min_rank: data.monthAwardMinRank ?? null,
                        is_base: data.isBase ?? false,
                        active: data.active ?? true,
                        sort_order: data.sortOrder ?? 0,
                    })
                    .where("id", "=", id)
                    .execute();

                await this.upsertSections(trx, id, data.sections);
            });

            return (await this.findById(id))!;
        } catch (e: any) {
            throw mapExamTypeDbError(e);
        }
    }

    async delete(id: number): Promise<void> {
        // Every rating screen resolves through the base type (resolveExamTypeId below) — deleting
        // it, even while it has no exams, would leave zero base types.
        const target = await pg.selectFrom("exam_types").select("is_base").where("id", "=", id).executeTakeFirst();
        if (!target) {
            const err: any = new Error("İmtahan növü tapılmadı");
            err.status = 404;
            throw err;
        }
        if (target.is_base) {
            const err: any = new Error("Əsas imtahan növünü silmək olmaz");
            err.status = 409;
            throw err;
        }

        const used = await pg
            .selectFrom("exams")
            .select(({ fn }) => [fn.countAll().as("count")])
            .where("exam_type_id", "=", id)
            .executeTakeFirstOrThrow();

        if (Number(used.count) > 0) {
            const err: any = new Error("Bu imtahan növünə aid imtahanlar var, silmək olmaz");
            err.status = 409;
            throw err;
        }

        await pg.deleteFrom("exam_types").where("id", "=", id).execute();
    }

    /** INSERT секций и их предметов внутри уже открытой транзакции — общий код create/update. */
    private async insertSections(
        trx: Transaction<DB>,
        examTypeId: number,
        sections: ExamTypeSectionInput[]
    ): Promise<void> {
        for (const section of sections) {
            const insertedSection = await trx
                .insertInto("exam_type_sections")
                .values({
                    exam_type_id: examTypeId,
                    name_az: section.nameAz,
                    grade_from: section.gradeFrom,
                    grade_to: section.gradeTo,
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

            if (section.subjects.length > 0) {
                await trx
                    .insertInto("exam_type_section_subjects")
                    .values(
                        section.subjects.map((sub) => ({
                            section_id: insertedSection.id,
                            subject_code: sub.subjectCode,
                            sort_order: sub.sortOrder ?? 0,
                        }))
                    )
                    .execute();
            }
        }
    }

    /**
     * Upsert секций по `id` (IMTAHAN_NOVLERI_TASK.md §11, долг из шага 1). Раньше update()
     * делал DELETE FROM exam_type_section_subjects → DELETE FROM exam_type_sections → INSERT
     * заново — безвредно, пока на exam_type_sections.id никто не ссылался. После миграции 024
     * на него ссылается student_results.section_id: пересоздание с новым id либо роняло бы
     * FK (если есть результаты), либо молча осиротило бы их (если делать ON DELETE SET NULL —
     * такого нет, схема как раз запрещает потерю ссылки).
     *
     * Правила:
     *  - секция с `id` из входных данных — UPDATE на месте (id не меняется, ссылки из
     *    student_results остаются рабочими); её набор предметов (exam_type_section_subjects)
     *    можно пересоздавать целиком — на эту таблицу никто не ссылается по отдельной строке,
     *    только по количеству строк, счётчик вопросов больше не хранится на конфиге секции
     *    вовсе (§16 ТЗ, снят 025d_question_counts_from_file.sql) — читается из файла/ручного
     *    ввода на каждом результате;
     *  - секция без `id` — новая, INSERT;
     *  - существующая секция, которой нет во входных данных, удаляется, ТОЛЬКО если на неё нет
     *    ссылок в student_results.section_id — иначе 409, а не потеря данных.
     */
    private async upsertSections(
        trx: Transaction<DB>,
        examTypeId: number,
        sections: ExamTypeSectionInput[]
    ): Promise<void> {
        const existing = await trx
            .selectFrom("exam_type_sections")
            .select(["id"])
            .where("exam_type_id", "=", examTypeId)
            .execute();
        const existingIds = new Set(existing.map((s) => s.id));

        const incomingIds = new Set(
            sections.filter((s): s is ExamTypeSectionInput & { id: number } => s.id !== undefined).map((s) => s.id)
        );

        for (const incomingId of incomingIds) {
            if (!existingIds.has(incomingId)) {
                const err: any = new Error("Bölmə bu imtahan növünə aid deyil");
                err.status = 400;
                throw err;
            }
        }

        const toDelete = [...existingIds].filter((sid) => !incomingIds.has(sid));
        if (toDelete.length > 0) {
            const referenced = await trx
                .selectFrom("student_results")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("section_id", "in", toDelete)
                .executeTakeFirstOrThrow();
            if (Number(referenced.count) > 0) {
                const err: any = new Error(
                    "Bölmələrdən birinin nəticələri var — onu silmək olmaz, əvvəlcə tərkibini dəyişin"
                );
                err.status = 409;
                throw err;
            }
            // ON DELETE CASCADE на exam_type_section_subjects (023) — набор предметов уходит вместе с секцией.
            await trx.deleteFrom("exam_type_sections").where("id", "in", toDelete).execute();
        }

        // A kept section must still cover every result already filed under it — otherwise those
        // results would point at a section whose grade range no longer contains their grade.
        for (const section of sections) {
            if (section.id === undefined) continue;
            const outside = await trx
                .selectFrom("student_results")
                .select(({ fn }) => [fn.countAll().as("count"), fn.min("grade").as("minGrade"), fn.max("grade").as("maxGrade")])
                .where("section_id", "=", section.id)
                .where((eb) => eb.or([eb("grade", "<", section.gradeFrom), eb("grade", ">", section.gradeTo)]))
                .executeTakeFirstOrThrow();
            if (Number(outside.count) > 0) {
                const err: any = new Error(
                    `"${section.nameAz}" bölməsində yeni aralıqdan (${section.gradeFrom}-${section.gradeTo}) kənarda qalan ` +
                    `${outside.count} nəticə var (siniflər ${outside.minGrade}-${outside.maxGrade}) — aralığı daraltmaq olmaz`
                );
                err.status = 409;
                throw err;
            }
        }

        // EXCLUDE (exam_type_id, grade range) is checked per statement, not at commit: moving a
        // boundary (1-4/5-11 -> 1-5/6-11) by updating sections one by one would overlap the
        // not-yet-updated neighbour. Park every kept section on a unique negative range first
        // ([-id, -id] never meets a real grade or another parked section), then write real ranges.
        for (const section of sections) {
            if (section.id !== undefined) {
                await trx
                    .updateTable("exam_type_sections")
                    .set({ grade_from: -section.id, grade_to: -section.id })
                    .where("id", "=", section.id)
                    .execute();
            }
        }

        for (const section of sections) {
            let sectionId: number;
            if (section.id !== undefined) {
                sectionId = section.id;
                await trx
                    .updateTable("exam_type_sections")
                    .set({ name_az: section.nameAz, grade_from: section.gradeFrom, grade_to: section.gradeTo })
                    .where("id", "=", sectionId)
                    .execute();
                // Набор предметов секции никто не референсит по отдельной строке — пересоздаём целиком.
                await trx.deleteFrom("exam_type_section_subjects").where("section_id", "=", sectionId).execute();
            } else {
                const inserted = await trx
                    .insertInto("exam_type_sections")
                    .values({
                        exam_type_id: examTypeId,
                        name_az: section.nameAz,
                        grade_from: section.gradeFrom,
                        grade_to: section.gradeTo,
                    })
                    .returning(["id"])
                    .executeTakeFirstOrThrow();
                sectionId = inserted.id;
            }

            if (section.subjects.length > 0) {
                await trx
                    .insertInto("exam_type_section_subjects")
                    .values(
                        section.subjects.map((sub) => ({
                            section_id: sectionId,
                            subject_code: sub.subjectCode,
                            sort_order: sub.sortOrder ?? 0,
                        }))
                    )
                    .execute();
            }
        }
    }

    /**
     * Менять level_scale_id у типа, у которого есть результаты в незакрытом учебном году,
     * запрещено — иначе внутри одного года pillə были бы выданы по разным шкалам.
     */
    private async assertLevelScaleChangeAllowed(
        trx: Transaction<DB>,
        examTypeId: number,
        newScaleId: number
    ): Promise<void> {
        const openResults = await sql<{ exists: boolean }>`
            SELECT EXISTS (
                SELECT 1 FROM student_results sr
                JOIN exams e ON e.id = sr.exam_id
                WHERE e.exam_type_id = ${examTypeId}
                  AND sr.academic_year IS NOT NULL
                  AND sr.academic_year NOT IN (SELECT academic_year FROM academic_year_closures)
            ) AS exists
        `.execute(trx);
        if (openResults.rows[0]?.exists) {
            const err: any = new Error(
                "Bu imtahan növünün cari (bağlanmamış) tədris ilində nəticələri var — şkalanı dəyişmək olmaz"
            );
            err.status = 409;
            throw err;
        }
    }
}

export const examTypeServicePg = new ExamTypeServicePg();

/** Constraint violations from 023 → 4xx with a message the admin can act on, instead of a raw 500. */
function mapExamTypeDbError(e: any): any {
    const fail = (message: string, status: number) => {
        const err: any = new Error(message);
        err.status = status;
        return err;
    };
    switch (e?.code) {
        case "23505":
            if (e.constraint === "exam_types_single_base") return fail("Əsas imtahan növü artıq mövcuddur", 409);
            if (e.constraint === "exam_types_code_key") return fail("Bu kodla imtahan növü artıq mövcuddur", 409);
            if (e.constraint === "exam_type_section_subjects_pkey") return fail("Bölmədə eyni fənn bir neçə dəfə seçilib", 400);
            return fail("Təkrarlanan məlumat", 409);
        case "23P01":
            return fail("Bölmələrin sinif aralıqları üst-üstə düşür", 400);
        case "23514":
            return fail("Bölmənin sinif aralığı düzgün deyil", 400);
        case "23503":
            return fail("Seçilmiş fənn və ya pillə meyarı tapılmadı", 400);
        default:
            return e;
    }
}

/**
 * IMTAHAN_NOVLERI_TASK.md §5 шаг 3: единственное место, где решается "какой тип экзамена
 * читать, если вызывающий не указал examTypeId явно". Используется /api/stats/* — существующие
 * экраны рейтингов не передают этот параметр вовсе и обязаны продолжать видеть базовый тип.
 * Бросает, если базового типа нет вовсе — инвариант "базовый тип всегда существует" держится
 * частичным уникальным индексом exam_types_single_base (запрещает ДВА базовых) и проверкой в
 * update() (запрещает снять is_base с единственного базового) — 0 базовых типов означало бы
 * повреждённые данные, а не штатный случай, который стоит тихо проглатывать.
 */
export async function resolveExamTypeId(examTypeId?: number | null): Promise<number> {
    if (examTypeId != null) return examTypeId;
    const base = await pg.selectFrom("exam_types").select("id").where("is_base", "=", true).executeTakeFirst();
    if (!base) {
        throw new Error("Baza imtahan növü tapılmadı — məlumat bazası zədələnib");
    }
    return base.id;
}
