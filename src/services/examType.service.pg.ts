import { sql, Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";

export interface ExamTypeSectionSubjectInput {
    subjectCode: string;
    maxQuestions: number;
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
    hasQuestionCounts?: boolean;
    monthAwardMinRank?: number | null;
    isBase?: boolean;
    active?: boolean;
    sortOrder?: number;
    sections: ExamTypeSectionInput[];
}

export interface ExamTypeSectionSubjectRow {
    subjectCode: string;
    nameAz: string; // из subjects.name_az, JOIN — фронту сразу нужно название, не только код
    maxQuestions: number;
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
    hasQuestionCounts: boolean;
    monthAwardMinRank: number | null;
    isBase: boolean;
    active: boolean;
    sortOrder: number;
    sections: ExamTypeSectionRow[];
}

/**
 * CRUD типов экзаменов, их секций и наборов предметов (IMTAHAN_NOVLERI_TASK.md §5). Отдаёт
 * «дерево» типа целиком (тип → секции → предметы) — фронту нужно именно так.
 */
export class ExamTypeServicePg {
    /** Все типы (включая неактивные), с вложенными секциями и предметами. */
    async findAll(): Promise<ExamTypeRow[]> {
        const [typeRows, sectionRows, subjectRows] = await Promise.all([
            pg
                .selectFrom("exam_types")
                .select([
                    "id", "code", "name_az", "level_scale_id", "has_question_counts",
                    "month_award_min_rank", "is_base", "active", "sort_order",
                ])
                .orderBy("sort_order", "asc")
                .execute(),
            pg
                .selectFrom("exam_type_sections")
                .select(["id", "exam_type_id", "name_az", "grade_from", "grade_to"])
                .orderBy("grade_from", "asc")
                .execute(),
            pg
                .selectFrom("exam_type_section_subjects as ss")
                .innerJoin("subjects as s", "s.code", "ss.subject_code")
                .select(["ss.section_id", "ss.subject_code", "s.name_az as name_az", "ss.max_questions", "ss.sort_order"])
                .orderBy("ss.sort_order", "asc")
                .execute(),
        ]);

        return typeRows.map((t) => ({
            id: t.id,
            code: t.code,
            nameAz: t.name_az,
            levelScaleId: t.level_scale_id,
            hasQuestionCounts: t.has_question_counts,
            monthAwardMinRank: t.month_award_min_rank,
            isBase: t.is_base,
            active: t.active,
            sortOrder: t.sort_order,
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
                            maxQuestions: sub.max_questions,
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
                        has_question_counts: data.hasQuestionCounts ?? true,
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
            if (e.code === "23505") {
                const err: any = new Error("Əsas imtahan növü artıq mövcuddur");
                err.status = 409;
                throw err;
            }
            throw e;
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
                        has_question_counts: data.hasQuestionCounts ?? true,
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
            if (e.code === "23505") {
                const err: any = new Error("Əsas imtahan növü artıq mövcuddur");
                err.status = 409;
                throw err;
            }
            throw e;
        }
    }

    async delete(id: number): Promise<void> {
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
                            max_questions: sub.maxQuestions,
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
     *    только через сумму max_questions, которая для истории уже снята в student_results
     *    (backfill 024) и результата не пересчитывает;
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
                            max_questions: sub.maxQuestions,
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
