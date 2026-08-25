import { pg } from "../config/pg";

export type ProfileChangeEntityType = "school" | "teacher" | "district";
export type ProfileChangeStatus = "pending" | "approved" | "rejected";

export interface ProfileChangeRequest {
    id: number;
    entityType: ProfileChangeEntityType;
    entityId: number;
    payload: Record<string, any>;
    status: ProfileChangeStatus;
    submittedBy: number;
    submittedAt: Date;
    reviewedBy: number | null;
    reviewedAt: Date | null;
    reviewNote: string | null;
}

export interface ProfileChangeQueueRow extends ProfileChangeRequest {
    entityName: string;
    submittedByEmail: string;
    /** Текущие (подтверждённые) значения тех же полей — для сравнения «было → стало». */
    current: Record<string, any>;
}

/** Поля профиля, которые фактически редактируются самим владельцем (BASE_FIXES_TASK.md §2.2/§2.5) —
 *  ровно то же множество, что должно попадать в payload заявки и в сравнение «было → стало».
 *  district.achievements НЕТ: в отличие от school/teacher, у districts такой колонки не существует
 *  (проверено по db/schema.sql) — раздел «Nailiyyətlər» в документе для района был ошибочным
 *  предположением при составлении ТЗ, в коде для района такого блока никогда не было. */
const ENTITY_FIELDS: Record<ProfileChangeEntityType, string[]> = {
    school: ["directorName", "foundedYear", "achievements"],
    teacher: ["gradeLabel", "pedagogicalExperienceYears", "achievements"],
    district: ["educationHeadName"],
};

function mapRow(row: any): ProfileChangeRequest {
    return {
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        payload: row.payload,
        status: row.status,
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
    };
}

export class ProfileChangeRequestServicePg {
    /**
     * Создаёт заявку или перезаписывает уже существующую pending (BASE_FIXES_TASK.md §2.5) —
     * повторное сохранение владельцем должно перезаписывать payload, а не плодить очередь.
     * SELECT ... FOR UPDATE внутри транзакции сериализует конкурентные сохранения одной и той
     * же сущности, чтобы не проскочить в гонке мимо частичного уникального индекса.
     */
    async submit(entityType: ProfileChangeEntityType, entityId: number, payload: Record<string, any>, submittedBy: number): Promise<ProfileChangeRequest> {
        return await pg.transaction().execute(async (trx) => {
            const existing = await trx
                .selectFrom("profile_change_requests")
                .selectAll()
                .where("entity_type", "=", entityType)
                .where("entity_id", "=", entityId)
                .where("status", "=", "pending")
                .forUpdate()
                .executeTakeFirst();

            if (existing) {
                // Merge, не replace: school/teacher разбивают самостоятельное редактирование на
                // отдельные формы (факты отдельно от достижений, BASE_FIXES_TASK.md §2.2) — если
                // тут просто перезаписать payload, второе сохранение стёрло бы первое, ещё не
                // подтверждённое админом.
                const mergedPayload = { ...(existing.payload as Record<string, any>), ...payload };
                const updated = await trx
                    .updateTable("profile_change_requests")
                    .set({
                        payload: JSON.stringify(mergedPayload),
                        submitted_by: submittedBy,
                        submitted_at: new Date(),
                    })
                    .where("id", "=", existing.id)
                    .returningAll()
                    .executeTakeFirstOrThrow();
                return mapRow(updated);
            }

            const inserted = await trx
                .insertInto("profile_change_requests")
                .values({
                    entity_type: entityType,
                    entity_id: entityId,
                    payload: JSON.stringify(payload),
                    submitted_by: submittedBy,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
            return mapRow(inserted);
        });
    }

    /** Текущая pending-заявка сущности или null — единственная точка, откуда payload попадает
     *  не-админу (и только владельцу этой же сущности, проверяется в контроллере). */
    async getCurrentPending(entityType: ProfileChangeEntityType, entityId: number): Promise<ProfileChangeRequest | null> {
        const row = await pg
            .selectFrom("profile_change_requests")
            .selectAll()
            .where("entity_type", "=", entityType)
            .where("entity_id", "=", entityId)
            .where("status", "=", "pending")
            .executeTakeFirst();
        return row ? mapRow(row) : null;
    }

    async getPendingById(id: number): Promise<ProfileChangeRequest | null> {
        const row = await pg
            .selectFrom("profile_change_requests")
            .selectAll()
            .where("id", "=", id)
            .where("status", "=", "pending")
            .executeTakeFirst();
        return row ? mapRow(row) : null;
    }

    async count(): Promise<number> {
        const row = await pg
            .selectFrom("profile_change_requests")
            .select(({ fn }) => [fn.countAll().as("count")])
            .where("status", "=", "pending")
            .executeTakeFirstOrThrow();
        return Number(row.count);
    }

    async pendingIds(entityType: ProfileChangeEntityType): Promise<number[]> {
        const rows = await pg
            .selectFrom("profile_change_requests")
            .select("entity_id")
            .where("entity_type", "=", entityType)
            .where("status", "=", "pending")
            .execute();
        return rows.map((r) => r.entity_id);
    }

    /**
     * Пишет решение (approved/rejected). `WHERE status = 'pending'` — защита от повторного
     * ревью: если заявку уже кто-то обработал, вернётся null, а не тихая перезапись чужого
     * решения. `finalPayload` — то, что реально применено (сценарий «Düzəliş et»: админ
     * поправил значения перед подтверждением) — если передан, заменяет исходный payload в
     * истории заявки, чтобы очередь отражала, что было применено на самом деле, а не что
     * изначально прислал владелец.
     */
    async markReviewed(
        id: number,
        status: "approved" | "rejected",
        reviewedBy: number,
        reviewNote: string | null,
        finalPayload?: Record<string, any>
    ): Promise<ProfileChangeRequest | null> {
        const row = await pg
            .updateTable("profile_change_requests")
            .set({
                status,
                reviewed_by: reviewedBy,
                reviewed_at: new Date(),
                review_note: reviewNote,
                ...(finalPayload !== undefined && { payload: JSON.stringify(finalPayload) }),
            })
            .where("id", "=", id)
            .where("status", "=", "pending")
            .returningAll()
            .executeTakeFirst();
        return row ? mapRow(row) : null;
    }

    /** Полиморфная связь без FK (см. схему) — при удалении сущности её заявки подчищаются
     *  явно, вызывающая сторона (usecase удаления school/teacher/district) должна звать это. */
    async deleteForEntity(entityType: ProfileChangeEntityType, entityId: number): Promise<void> {
        await pg
            .deleteFrom("profile_change_requests")
            .where("entity_type", "=", entityType)
            .where("entity_id", "=", entityId)
            .execute();
    }

    /** То же для массового удаления (schools/teachers/districts bulk-delete). */
    async deleteForEntities(entityType: ProfileChangeEntityType, entityIds: number[]): Promise<void> {
        if (entityIds.length === 0) return;
        await pg
            .deleteFrom("profile_change_requests")
            .where("entity_type", "=", entityType)
            .where("entity_id", "in", entityIds)
            .execute();
    }

    /**
     * Очередь для страницы модерации (BASE_FIXES_TASK.md §2.7): имя сущности, email
     * отправителя и текущие (подтверждённые) значения тех же полей — чтобы отрисовать
     * сравнение «было → стало» без похода в три разных usecase на фронте.
     */
    async listQueue(status: ProfileChangeStatus = "pending"): Promise<ProfileChangeQueueRow[]> {
        const requests = await pg
            .selectFrom("profile_change_requests as pcr")
            .leftJoin("users as u", "u.id", "pcr.submitted_by")
            .select([
                "pcr.id as id", "pcr.entity_type as entity_type", "pcr.entity_id as entity_id",
                "pcr.payload as payload", "pcr.status as status", "pcr.submitted_by as submitted_by",
                "pcr.submitted_at as submitted_at", "pcr.reviewed_by as reviewed_by",
                "pcr.reviewed_at as reviewed_at", "pcr.review_note as review_note",
                "u.email as submitted_by_email",
            ])
            .where("pcr.status", "=", status)
            .orderBy("pcr.submitted_at", "desc")
            .execute();

        if (requests.length === 0) return [];

        const idsByType: Record<ProfileChangeEntityType, number[]> = { school: [], teacher: [], district: [] };
        for (const r of requests) idsByType[r.entity_type as ProfileChangeEntityType].push(r.entity_id);

        const [schoolRows, teacherRows, districtRows] = await Promise.all([
            idsByType.school.length > 0
                ? pg.selectFrom("schools").select(["id", "name", "director_name", "founded_year", "achievements"]).where("id", "in", idsByType.school).execute()
                : Promise.resolve([]),
            idsByType.teacher.length > 0
                ? pg.selectFrom("teachers").select(["id", "fullname", "grade_label", "pedagogical_experience_years", "achievements"]).where("id", "in", idsByType.teacher).execute()
                : Promise.resolve([]),
            idsByType.district.length > 0
                ? pg.selectFrom("districts").select(["id", "name", "education_head_name"]).where("id", "in", idsByType.district).execute()
                : Promise.resolve([]),
        ]);

        const schoolById = new Map(schoolRows.map((s) => [s.id, s]));
        const teacherById = new Map(teacherRows.map((t) => [t.id, t]));
        const districtById = new Map(districtRows.map((d) => [d.id, d]));

        return requests.map((r): ProfileChangeQueueRow => {
            let entityName = "—";
            let current: Record<string, any> = {};
            if (r.entity_type === "school") {
                const s = schoolById.get(r.entity_id);
                entityName = s?.name ?? "—";
                current = { directorName: s?.director_name ?? null, foundedYear: s?.founded_year ?? null, achievements: s?.achievements ?? null };
            } else if (r.entity_type === "teacher") {
                const t = teacherById.get(r.entity_id);
                entityName = t?.fullname ?? "—";
                current = { gradeLabel: t?.grade_label ?? null, pedagogicalExperienceYears: t?.pedagogical_experience_years ?? null, achievements: t?.achievements ?? null };
            } else {
                const d = districtById.get(r.entity_id);
                entityName = d?.name ?? "—";
                current = { educationHeadName: d?.education_head_name ?? null };
            }

            return {
                ...mapRow(r),
                entityName,
                submittedByEmail: r.submitted_by_email ?? "—",
                current,
            };
        });
    }
}

export const profileChangeRequestServicePg = new ProfileChangeRequestServicePg();
export const PROFILE_CHANGE_ENTITY_FIELDS = ENTITY_FIELDS;
