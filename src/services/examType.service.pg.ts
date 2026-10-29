import { Kysely, sql, Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export interface ExamTypeSectionSubjectInput {
    subjectCode: string;
    sortOrder?: number;
}

/** Sections are sent in display order: the array index becomes sort_order. Archived sections are never sent. */
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
    /** Academic years (start year) the section is in force, inclusive; null = unbounded (040). */
    fromYear: number | null;
    toYear: number | null;
    /** toYear is before the current academic year: read-only history, not part of the editable config. */
    archived: boolean;
    sortOrder: number;
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
                .select(["id", "exam_type_id", "name_az", "grade_from", "grade_to", "from_year", "to_year", "sort_order"])
                .orderBy("sort_order", "asc")
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
        const currentYear = getCurrentAcademicYear();

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
                    fromYear: sec.from_year,
                    toYear: sec.to_year,
                    archived: sec.to_year !== null && sec.to_year < currentYear,
                    sortOrder: sec.sort_order,
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
        for (const [index, section] of sections.entries()) {
            const insertedSection = await trx
                .insertInto("exam_type_sections")
                .values({
                    exam_type_id: examTypeId,
                    name_az: section.nameAz,
                    grade_from: section.gradeFrom,
                    grade_to: section.gradeTo,
                    sort_order: index,
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
     * Upsert секций по `id` (IMTAHAN_NOVLERI_TASK.md §11) с версиями по учебным годам (040). На
     * exam_type_sections.id ссылается student_results.section_id (024), поэтому секцию никогда не
     * пересоздают с новым id и не удаляют, пока на неё ссылаются.
     *
     * The editable config is the sections in force now (to_year null or >= current year); archived ones are
     * neither sent nor touched. For each current section:
     *  - it has results from past academic years and the admin removed it or changed its grades or subject
     *    set → it is archived (to_year = current - 1; id, name, subjects and results stay) and the incoming
     *    entry, if any, is inserted as a new section. Last year's config stays as it was, so a re-upload or an
     *    edit of an old result still resolves (type, grade, year) to it — findSectionForGrade below;
     *  - otherwise it is updated in place, or deleted when removed;
     *  - a new or in-place section that meets an archived one on grades starts the year after it (from_year),
     *    so grade ranges never overlap within one year (EXCLUDE from 040).
     * Then every result of the current year and later is moved to the section that covers its grade in its
     * year. A result left without one → 409 and the whole transaction rolls back. Ratings never read
     * section_id, so none of this touches *_year_ratings.
     */
    private async upsertSections(
        trx: Transaction<DB>,
        examTypeId: number,
        sections: ExamTypeSectionInput[]
    ): Promise<void> {
        const currentYear = getCurrentAcademicYear();
        // Year of a result for section purposes — the import's formula (July/August → the year just ended).
        const resultYear = sql<number>`(CASE WHEN sr.month >= 9 THEN sr.year ELSE sr.year - 1 END)`;

        const allSections = await trx
            .selectFrom("exam_type_sections")
            .select(["id", "grade_from", "grade_to", "from_year", "to_year"])
            .where("exam_type_id", "=", examTypeId)
            .execute();
        const current = allSections.filter((s) => s.to_year === null || s.to_year >= currentYear);
        const currentById = new Map(current.map((s) => [s.id, s]));

        const incomingById = new Map<number, ExamTypeSectionInput>();
        for (const section of sections) {
            if (section.id === undefined) continue;
            if (!currentById.has(section.id) || incomingById.has(section.id)) {
                const err: any = new Error("Bölmə bu imtahan növünə aid deyil və ya arxivdədir");
                err.status = 400;
                throw err;
            }
            incomingById.set(section.id, section);
        }

        const currentIds = [...currentById.keys()];
        const subjectRows = currentIds.length === 0 ? [] : await trx
            .selectFrom("exam_type_section_subjects")
            .select(["section_id", "subject_code"])
            .where("section_id", "in", currentIds)
            .execute();
        const sameSubjects = (sectionId: number, incoming: ExamTypeSectionInput): boolean => {
            const stored = new Set(subjectRows.filter((r) => r.section_id === sectionId).map((r) => r.subject_code));
            const next = new Set(incoming.subjects.map((s) => s.subjectCode));
            return stored.size === next.size && [...stored].every((code) => next.has(code));
        };

        const withPastResults = new Set(
            currentIds.length === 0 ? [] : (await trx
                .selectFrom("student_results as sr")
                .select("sr.section_id")
                .distinct()
                .where("sr.section_id", "in", currentIds)
                .where(sql<boolean>`${resultYear} < ${currentYear}`)
                .execute()).map((r) => r.section_id)
        );

        const toArchive = new Set<number>();
        const toDelete: number[] = [];
        for (const existing of current) {
            const incoming = incomingById.get(existing.id);
            const changed = !incoming
                || incoming.gradeFrom !== existing.grade_from
                || incoming.gradeTo !== existing.grade_to
                || !sameSubjects(existing.id, incoming);
            if (changed && withPastResults.has(existing.id)) toArchive.add(existing.id);
            else if (!incoming) toDelete.push(existing.id);
        }

        if (toArchive.size > 0) {
            await trx
                .updateTable("exam_type_sections")
                .set({ to_year: currentYear - 1 })
                .where("id", "in", [...toArchive])
                .execute();
        }

        const archived = [
            ...allSections.filter((s) => s.to_year !== null && s.to_year < currentYear),
            ...current.filter((s) => toArchive.has(s.id)).map((s) => ({ ...s, to_year: currentYear - 1 })),
        ];
        const startYear = (gradeFrom: number, gradeTo: number, ownFromYear: number | null): number | null => {
            let fromYear = ownFromYear;
            for (const a of archived) {
                if (a.grade_from <= gradeTo && gradeFrom <= a.grade_to && (fromYear === null || fromYear <= a.to_year!)) {
                    fromYear = a.to_year! + 1;
                }
            }
            return fromYear;
        };

        // EXCLUDE is checked per statement, not at commit: moving a boundary (1-4/5-11 -> 1-5/6-11) by updating
        // sections one by one would overlap the not-yet-updated neighbour. Park every current section that is not
        // archived on a unique negative range first ([-id, -id] never meets a real grade or another parked
        // section), then write real ranges. Sections to delete stay parked until deleted, so the re-pointing
        // below can never land a result on them.
        for (const s of current) {
            if (toArchive.has(s.id)) continue;
            await trx
                .updateTable("exam_type_sections")
                .set({ grade_from: -s.id, grade_to: -s.id })
                .where("id", "=", s.id)
                .execute();
        }

        for (const [index, section] of sections.entries()) {
            const keptId = section.id !== undefined && !toArchive.has(section.id) ? section.id : undefined;
            let sectionId: number;
            if (keptId !== undefined) {
                sectionId = keptId;
                await trx
                    .updateTable("exam_type_sections")
                    .set({
                        name_az: section.nameAz,
                        grade_from: section.gradeFrom,
                        grade_to: section.gradeTo,
                        from_year: startYear(section.gradeFrom, section.gradeTo, currentById.get(keptId)!.from_year),
                        sort_order: index,
                    })
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
                        from_year: startYear(section.gradeFrom, section.gradeTo, null),
                        sort_order: index,
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

        // Results of the current year and later follow the new config. Their scores, percent and pillə stay as
        // computed at upload — only the section pointer moves.
        await sql`
            UPDATE student_results sr
            SET section_id = s.id
            FROM exam_type_sections s
            WHERE sr.exam_type_id = ${examTypeId}
              AND sr.section_id IS NOT NULL
              AND ${resultYear} >= ${currentYear}
              AND s.exam_type_id = ${examTypeId}
              AND sr.grade BETWEEN s.grade_from AND s.grade_to
              AND (s.from_year IS NULL OR s.from_year <= ${resultYear})
              AND (s.to_year IS NULL OR s.to_year >= ${resultYear})
              AND sr.section_id <> s.id
        `.execute(trx);

        const orphaned = await sql<{ count: number; min_grade: number; max_grade: number }>`
            SELECT count(*)::int AS count, min(sr.grade) AS min_grade, max(sr.grade) AS max_grade
            FROM student_results sr
            JOIN exam_type_sections s ON s.id = sr.section_id
            WHERE sr.exam_type_id = ${examTypeId}
              AND ${resultYear} >= ${currentYear}
              AND (sr.grade NOT BETWEEN s.grade_from AND s.grade_to
                   OR (s.from_year IS NOT NULL AND s.from_year > ${resultYear})
                   OR (s.to_year IS NOT NULL AND s.to_year < ${resultYear}))
        `.execute(trx);
        const left = orphaned.rows[0];
        if (left && left.count > 0) {
            const grades = left.min_grade === left.max_grade ? `${left.min_grade}` : `${left.min_grade}-${left.max_grade}`;
            const err: any = new Error(
                `Cari tədris ilinin ${left.count} nəticəsi (siniflər ${grades}) yeni bölmələrin heç birinə düşmür — ` +
                `bu sinifləri əhatə edən bölmə saxlayın və ya əlavə edin`
            );
            err.status = 409;
            throw err;
        }

        if (toDelete.length > 0) {
            // ON DELETE CASCADE на exam_type_section_subjects (023) — набор предметов уходит вместе с секцией.
            await trx.deleteFrom("exam_type_sections").where("id", "in", toDelete).execute();
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

export function isSectionInForce(section: { fromYear: number | null; toYear: number | null }, academicYear: number): boolean {
    return (section.fromYear === null || section.fromYear <= academicYear)
        && (section.toYear === null || section.toYear >= academicYear);
}

/** The section of the type that covers `grade` in `academicYear` (040: sections have year windows). */
export async function findSectionForGrade(
    db: Kysely<DB>,
    examTypeId: number,
    grade: number,
    academicYear: number
): Promise<{ id: number; name_az: string } | undefined> {
    return db
        .selectFrom("exam_type_sections")
        .select(["id", "name_az"])
        .where("exam_type_id", "=", examTypeId)
        .where("grade_from", "<=", grade)
        .where("grade_to", ">=", grade)
        .where((eb) => eb.or([eb("from_year", "is", null), eb("from_year", "<=", academicYear)]))
        .where((eb) => eb.or([eb("to_year", "is", null), eb("to_year", ">=", academicYear)]))
        .executeTakeFirst();
}
