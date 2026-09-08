import { pg } from "../config/pg";

export interface Subject {
    code: string;
    nameAz: string;
    sortOrder: number;
    active: boolean;
}

export interface SubjectInput {
    code: string;
    nameAz: string;
    sortOrder?: number;
    active?: boolean;
}

function mapRow(r: { code: string; name_az: string; sort_order: number; active: boolean }): Subject {
    return { code: r.code, nameAz: r.name_az, sortOrder: r.sort_order, active: r.active };
}

/**
 * Справочник предметов (IMTAHAN_NOVLERI_TASK.md §5) — после 023_exam_types_and_level_scales.sql
 * это чистый справочник кодов (code, name_az, sort_order, active), без привязки к колонкам
 * student_results.
 */
export class SubjectServicePg {
    /** Все предметы, включая active=false — это админ-справочник. */
    async findAll(): Promise<Subject[]> {
        const rows = await pg
            .selectFrom("subjects")
            .select(["code", "name_az", "sort_order", "active"])
            .orderBy("sort_order", "asc")
            .execute();
        return rows.map(mapRow);
    }

    async findByCode(code: string): Promise<Subject | null> {
        const row = await pg
            .selectFrom("subjects")
            .select(["code", "name_az", "sort_order", "active"])
            .where("code", "=", code)
            .executeTakeFirst();
        return row ? mapRow(row) : null;
    }

    async create(data: SubjectInput): Promise<Subject> {
        try {
            const row = await pg
                .insertInto("subjects")
                .values({
                    code: data.code,
                    name_az: data.nameAz,
                    sort_order: data.sortOrder ?? 0,
                    active: data.active ?? true,
                })
                .returning(["code", "name_az", "sort_order", "active"])
                .executeTakeFirstOrThrow();
            return mapRow(row);
        } catch (e: any) {
            if (e.code === "23505") {
                const err: any = new Error("Bu kodla fənn artıq mövcuddur");
                err.status = 409;
                throw err;
            }
            throw e;
        }
    }

    async update(code: string, data: Partial<Omit<SubjectInput, "code">>): Promise<Subject> {
        const row = await pg
            .updateTable("subjects")
            .set({
                ...(data.nameAz !== undefined && { name_az: data.nameAz }),
                ...(data.sortOrder !== undefined && { sort_order: data.sortOrder }),
                ...(data.active !== undefined && { active: data.active }),
            })
            .where("code", "=", code)
            .returning(["code", "name_az", "sort_order", "active"])
            .executeTakeFirst();

        if (!row) {
            const err: any = new Error("Fənn tapılmadı");
            err.status = 404;
            throw err;
        }
        return mapRow(row);
    }

    /**
     * Не вызывается ни из одного роута (нет DELETE /subjects в §5.3 ТЗ) — метод существует для
     * полноты сервиса per ТЗ §5 ("Удаление предмета... запрещать") и будет использован, когда
     * появится DELETE-роут. С 024_student_result_subject_scores.sql проверяет ссылки и на
     * exam_type_section_subjects (набор предметов секции), и на student_result_subject_scores
     * (реальные баллы результатов) — предмет, использованный хоть раз, не удаляется никогда.
     */
    async delete(code: string): Promise<void> {
        const [usedInSections, usedInResults] = await Promise.all([
            pg
                .selectFrom("exam_type_section_subjects")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("subject_code", "=", code)
                .executeTakeFirstOrThrow(),
            pg
                .selectFrom("student_result_subject_scores")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("subject_code", "=", code)
                .executeTakeFirstOrThrow(),
        ]);

        if (Number(usedInSections.count) > 0 || Number(usedInResults.count) > 0) {
            const err: any = new Error("Bu fənn imtahan növü bölmələrində və ya nəticələrdə istifadə olunur, silmək olmaz");
            err.status = 409;
            throw err;
        }

        await pg.deleteFrom("subjects").where("code", "=", code).execute();
    }
}

export const subjectServicePg = new SubjectServicePg();
