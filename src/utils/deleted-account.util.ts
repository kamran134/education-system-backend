import { sql } from "kysely";
import { pg } from "../config/pg";

export const DELETED_ACCOUNT_MESSAGE = "Hesabınızın bağlı olduğu qeyd silinib. Administratorla əlaqə saxlayın.";

interface LinkedEntityIds {
    studentId: number | null;
    teacherId: number | null;
    schoolId: number | null;
    districtId: number | null;
}

/**
 * SOFT_DELETE_TASK.md §6.1: true if the student / teacher / school / district the account is linked to is
 * soft-deleted. Reads the *_all base tables on purpose (the plain names are views that hide deleted rows).
 * Accounts of deleted entities are kept, but login and token refresh are refused until the entity is restored.
 */
export async function isLinkedEntityDeleted(user: LinkedEntityIds): Promise<boolean> {
    if (user.studentId === null && user.teacherId === null && user.schoolId === null && user.districtId === null) {
        return false;
    }
    const result = await sql<{ deleted: boolean }>`
        SELECT (
            EXISTS (SELECT 1 FROM students_all  WHERE id = ${user.studentId}  AND deleted_at IS NOT NULL) OR
            EXISTS (SELECT 1 FROM teachers_all  WHERE id = ${user.teacherId}  AND deleted_at IS NOT NULL) OR
            EXISTS (SELECT 1 FROM schools_all   WHERE id = ${user.schoolId}   AND deleted_at IS NOT NULL) OR
            EXISTS (SELECT 1 FROM districts_all WHERE id = ${user.districtId} AND deleted_at IS NOT NULL)
        ) AS deleted
    `.execute(pg);
    return result.rows[0]?.deleted === true;
}
