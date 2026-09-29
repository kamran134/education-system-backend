import { Transaction } from "kysely";
import { DB } from "../types/db";

/**
 * DUZELISLER_2026-09-29 п.1: удаляет аккаунты users, привязанные к удаляемым школе/учителю/ученику
 * (schoolDirector.school_id, teacher.teacher_id, student.student_id) — без ON DELETE на этих FK
 * (users.school_id/teacher_id/student_id → schools/teachers/students) удаление сущности иначе падает
 * с users_school_id_fkey/users_teacher_id_fkey/users_student_id_fkey. Аккаунт без сущности, к которой
 * он привязан, бессмысленен, поэтому удаляется вместе с ней, а не отвязывается.
 *
 * profile_change_requests.submitted_by (NOT NULL) — заявки удаляемого пользователя удаляются целиком;
 * reviewed_by (nullable) — только обнуляется, сама заявка (чужая, только рассмотренная этим юзером)
 * не должна пропасть. Остальные FK на users(id) (code_change_logs.changed_by, grade_promotion_logs.
 * executed_by, academic_year_closures.closed_by, app_settings.updated_by) пишутся только admin/
 * superadmin, у которых нет school/teacher/student-привязки — их эта функция не касается.
 */
export async function deleteLinkedUsers(
    trx: Transaction<DB>,
    by: { schoolIds?: number[]; teacherIds?: number[]; studentIds?: number[] }
): Promise<number> {
    const schoolIds = by.schoolIds ?? [];
    const teacherIds = by.teacherIds ?? [];
    const studentIds = by.studentIds ?? [];

    if (schoolIds.length === 0 && teacherIds.length === 0 && studentIds.length === 0) {
        return 0;
    }

    const users = await trx
        .selectFrom("users")
        .select("id")
        .where(({ eb, or }) => {
            const conditions = [];
            if (schoolIds.length > 0) conditions.push(eb("school_id", "in", schoolIds));
            if (teacherIds.length > 0) conditions.push(eb("teacher_id", "in", teacherIds));
            if (studentIds.length > 0) conditions.push(eb("student_id", "in", studentIds));
            return or(conditions);
        })
        .execute();

    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return 0;

    await trx.deleteFrom("profile_change_requests").where("submitted_by", "in", userIds).execute();
    await trx.updateTable("profile_change_requests").set({ reviewed_by: null }).where("reviewed_by", "in", userIds).execute();

    const result = await trx.deleteFrom("users").where("id", "in", userIds).executeTakeFirst();
    return Number(result.numDeletedRows);
}
