import { sql, Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { statsServicePg } from "./stats.service.pg";

/**
 * Soft delete of districts / schools / teachers / students (SOFT_DELETE_TASK.md, migration 037).
 *
 * The four tables are physically `<name>_all`; the same-named views hide rows with deleted_at set, so the rest of
 * the application keeps reading `students`, `teachers`, `schools`, `districts` and never sees a hidden row. This
 * service is one of the few places that reads `*_all` on purpose.
 *
 * A delete creates one `deletions` batch: the root entity plus every live descendant (district -> schools ->
 * teachers -> students), all stamped with the same `deletion_id`. Restore brings back exactly that batch, not rows
 * that were hidden earlier by a separate delete. Invariant: a live row never references a hidden one (checked on
 * restore). No hard delete exists by design — *_year_ratings are ON DELETE CASCADE, a real DELETE would wipe closed
 * academic years and break their checksums.
 */

export type DeletionEntityType = "district" | "school" | "teacher" | "student";

/**
 * What was hidden TOGETHER WITH the root (the root itself is not counted); `results` is the number of
 * student_results rows of all hidden students, the root included when it is a student.
 */
export interface DeletionCounts {
    schools: number;
    teachers: number;
    students: number;
    results: number;
}

export interface DeletionListItem {
    id: number;
    entityType: DeletionEntityType;
    entityId: number;
    code: number | null;
    name: string | null;
    path: { districtName: string | null; schoolName: string | null; teacherName: string | null };
    deletedAt: Date;
    deletedBy: { id: number; email: string } | null;
    counts: DeletionCounts;
}

export const DELETION_ENTITY_TYPES: readonly DeletionEntityType[] = ["district", "school", "teacher", "student"];

type BaseTable = "students_all" | "teachers_all" | "schools_all" | "districts_all";

const NOT_FOUND_MESSAGE: Record<DeletionEntityType, string> = {
    district: "District not found",
    school: "School not found",
    teacher: "Teacher not found",
    student: "Student not found",
};

/** Azerbaijani, dative case — «Bu kod silinmiş <şagirdə> məxsusdur». */
const ENTITY_DATIVE_AZ: Record<DeletionEntityType, string> = {
    district: "rayona",
    school: "məktəbə",
    teacher: "müəllimə",
    student: "şagirdə",
};

/** Azerbaijani, accusative with the possessive suffix — «Əvvəlcə «...» <məktəbini> bərpa edin». */
const ENTITY_ACCUSATIVE_AZ: Record<DeletionEntityType, string> = {
    district: "rayonunu",
    school: "məktəbini",
    teacher: "müəllimini",
    student: "şagirdini",
};

function httpError(status: number, message: string): Error {
    const err: any = new Error(message);
    err.status = status;
    return err;
}

async function idsOf(trx: Transaction<DB>, query: { execute: (db: Transaction<DB>) => Promise<{ rows: Array<{ id: number }> }> }): Promise<number[]> {
    const result = await query.execute(trx);
    return result.rows.map((r) => Number(r.id));
}

async function hide(
    trx: Transaction<DB>,
    table: BaseTable,
    ids: number[],
    deletionId: number,
    userId: number | null
): Promise<void> {
    if (ids.length === 0) return;
    await sql`
        UPDATE ${sql.table(table)}
        SET deleted_at = now(), deleted_by = ${userId}, deletion_id = ${deletionId}
        WHERE id = ANY(${ids}::bigint[]) AND deleted_at IS NULL
    `.execute(trx);
}

/**
 * Soft-deletes `id` of the given type inside the caller's transaction. Cascade is collected over LIVE rows only
 * (earlier individually deleted descendants stay in their own batch). The wide OR conditions are there to keep the
 * invariant "no live row points to a hidden one" (e.g. a student of another school assigned to a teacher of the
 * deleted school is hidden too).
 */
export async function softDelete(
    trx: Transaction<DB>,
    type: DeletionEntityType,
    id: number,
    userId: number | null
): Promise<{ deletionId: number; counts: DeletionCounts }> {
    // 1. Root must be live (404 otherwise, like the old hard delete); the row lock serialises concurrent deletes.
    const rootTable = ({ district: "districts", school: "schools", teacher: "teachers", student: "students" } as const)[type];
    const root = await sql<{ id: number }>`SELECT id FROM ${sql.table(rootTable)} WHERE id = ${id} FOR UPDATE`.execute(trx);
    if (root.rows.length === 0) throw httpError(404, NOT_FOUND_MESSAGE[type]);

    // 2. Cascade over live rows.
    let schoolIds: number[] = [];
    let teacherIds: number[] = [];
    let studentIds: number[] = [];

    if (type === "district") {
        schoolIds = await idsOf(trx, sql<{ id: number }>`SELECT id FROM schools WHERE district_id = ${id}`);
        teacherIds = await idsOf(trx, sql<{ id: number }>`
            SELECT id FROM teachers WHERE district_id = ${id} OR school_id = ANY(${schoolIds}::bigint[])`);
        studentIds = await idsOf(trx, sql<{ id: number }>`
            SELECT id FROM students
            WHERE district_id = ${id} OR school_id = ANY(${schoolIds}::bigint[]) OR teacher_id = ANY(${teacherIds}::bigint[])`);
    } else if (type === "school") {
        teacherIds = await idsOf(trx, sql<{ id: number }>`SELECT id FROM teachers WHERE school_id = ${id}`);
        studentIds = await idsOf(trx, sql<{ id: number }>`
            SELECT id FROM students WHERE school_id = ${id} OR teacher_id = ANY(${teacherIds}::bigint[])`);
    } else if (type === "teacher") {
        studentIds = await idsOf(trx, sql<{ id: number }>`SELECT id FROM students WHERE teacher_id = ${id}`);
    }

    const counts: DeletionCounts = {
        schools: schoolIds.length,
        teachers: teacherIds.length,
        students: studentIds.length,
        results: 0,
    };

    // Sets that include the root itself (used for the actual UPDATEs and for the sessions).
    const allDistrictIds = type === "district" ? [id] : [];
    const allSchoolIds = type === "school" ? [id, ...schoolIds] : schoolIds;
    const allTeacherIds = type === "teacher" ? [id, ...teacherIds] : teacherIds;
    const allStudentIds = type === "student" ? [id, ...studentIds] : studentIds;

    if (allStudentIds.length > 0) {
        const r = await sql<{ n: string }>`
            SELECT count(*)::text AS n FROM student_results WHERE student_id = ANY(${allStudentIds}::bigint[])`.execute(trx);
        counts.results = Number(r.rows[0].n);
    }

    // 3. Batch row, then hide everything with the same deletion_id.
    const inserted = await sql<{ id: number }>`
        INSERT INTO deletions (entity_type, entity_id, deleted_by, counts)
        VALUES (${type}, ${id}, ${userId}, ${JSON.stringify(counts)}::jsonb)
        RETURNING id
    `.execute(trx);
    const deletionId = Number(inserted.rows[0].id);

    await hide(trx, "students_all", allStudentIds, deletionId, userId);
    await hide(trx, "teachers_all", allTeacherIds, deletionId, userId);
    await hide(trx, "schools_all", allSchoolIds, deletionId, userId);
    await hide(trx, "districts_all", allDistrictIds, deletionId, userId);

    // 4. Accounts of hidden entities cannot log in or refresh; the users themselves stay (restore gives access back).
    await sql`
        DELETE FROM user_refresh_tokens
        WHERE user_id IN (
            SELECT id FROM users
            WHERE student_id = ANY(${allStudentIds}::bigint[])
               OR teacher_id = ANY(${allTeacherIds}::bigint[])
               OR school_id = ANY(${allSchoolIds}::bigint[])
               OR district_id = ANY(${allDistrictIds}::bigint[])
        )
    `.execute(trx);

    // 5. student_results, *_year_ratings, issued_certificates, achievement_files, profile_change_requests stay as they are.
    return { deletionId, counts };
}

/**
 * Best-effort recompute of the current year's *_year_ratings after a delete / restore. Not awaited by the caller:
 * a closed year is silently skipped (409 from assertYearNotClosed), anything else is only logged. The recompute
 * takes an advisory lock, so concurrent calls are safe.
 */
export function refreshRatingsInBackground(): void {
    statsServicePg.updateAllStats().catch((err: any) => {
        if (err?.status === 409) return;
        console.error("[deletion] background ratings refresh failed:", err);
    });
}

/** One transaction, one batch. Throws a 404 error if the entity is not live. */
export async function deleteEntity(type: DeletionEntityType, id: number, userId: number | null): Promise<void> {
    await pg.transaction().execute((trx) => softDelete(trx, type, id, userId));
    refreshRatingsInBackground();
}

/**
 * Deletes several entities of one type in a single transaction, one batch per entity (each can be restored
 * separately). The first id that is not live aborts the whole call with a 404.
 */
export async function deleteEntities(type: DeletionEntityType, ids: number[], userId: number | null): Promise<number> {
    const unique = Array.from(new Set(ids));
    await pg.transaction().execute(async (trx) => {
        for (const id of unique) {
            await softDelete(trx, type, id, userId);
        }
    });
    if (unique.length > 0) refreshRatingsInBackground();
    return unique.length;
}

interface RestoredIds {
    districts: number[];
    schools: number[];
    teachers: number[];
    students: number[];
}

/**
 * Name of the topmost still-hidden parent of the restored rows (district before school before teacher: restoring
 * a higher parent brings the lower ones back with it), or null. Runs after the restoring UPDATE in the same
 * transaction, so the rows of this batch already count as live.
 */
async function findHiddenParent(
    trx: Transaction<DB>,
    restored: RestoredIds
): Promise<{ type: DeletionEntityType; name: string; code: number } | null> {
    const res = await sql<{ type: DeletionEntityType; name: string; code: number }>`
        SELECT type, name, code FROM (
            SELECT 'district' AS type, p.name AS name, p.code AS code, 1 AS prio
              FROM districts_all p
             WHERE p.deleted_at IS NOT NULL AND p.id IN (
                   SELECT district_id FROM students_all WHERE id = ANY(${restored.students}::bigint[])
                   UNION SELECT district_id FROM teachers_all WHERE id = ANY(${restored.teachers}::bigint[])
                   UNION SELECT district_id FROM schools_all  WHERE id = ANY(${restored.schools}::bigint[]))
            UNION ALL
            SELECT 'school', p.name, p.code, 2
              FROM schools_all p
             WHERE p.deleted_at IS NOT NULL AND p.id IN (
                   SELECT school_id FROM students_all WHERE id = ANY(${restored.students}::bigint[])
                   UNION SELECT school_id FROM teachers_all WHERE id = ANY(${restored.teachers}::bigint[]))
            UNION ALL
            SELECT 'teacher', p.fullname, p.code, 3
              FROM teachers_all p
             WHERE p.deleted_at IS NOT NULL AND p.id IN (
                   SELECT teacher_id FROM students_all WHERE id = ANY(${restored.students}::bigint[]))
        ) x
        ORDER BY prio, code
        LIMIT 1
    `.execute(trx);
    const row = res.rows[0];
    return row ? { type: row.type, name: row.name, code: Number(row.code) } : null;
}

/**
 * Brings back exactly the rows of one batch. 404 for an unknown batch, 409 if it was restored already or if a
 * restored row would point to a parent that is still hidden (the whole transaction is rolled back then).
 */
export async function restoreDeletion(deletionId: number, userId: number | null): Promise<DeletionCounts> {
    const counts = await pg.transaction().execute(async (trx) => {
        const batch = await sql<{ counts: DeletionCounts; restored_at: Date | null }>`
            SELECT counts, restored_at FROM deletions WHERE id = ${deletionId} FOR UPDATE
        `.execute(trx);
        if (batch.rows.length === 0) throw httpError(404, "Silinmə qeydi tapılmadı");
        if (batch.rows[0].restored_at !== null) throw httpError(409, "Artıq bərpa edilib");

        const restored: RestoredIds = { districts: [], schools: [], teachers: [], students: [] };
        const targets: Array<[BaseTable, keyof RestoredIds]> = [
            ["districts_all", "districts"],
            ["schools_all", "schools"],
            ["teachers_all", "teachers"],
            ["students_all", "students"],
        ];
        for (const [table, key] of targets) {
            restored[key] = await idsOf(trx, sql<{ id: number }>`SELECT id FROM ${sql.table(table)} WHERE deletion_id = ${deletionId}`);
            if (restored[key].length > 0) {
                await sql`
                    UPDATE ${sql.table(table)} SET deleted_at = NULL, deleted_by = NULL, deletion_id = NULL
                    WHERE deletion_id = ${deletionId}
                `.execute(trx);
            }
        }

        const parent = await findHiddenParent(trx, restored);
        if (parent) {
            throw httpError(409, `Əvvəlcə «${parent.name} (${parent.code})» ${ENTITY_ACCUSATIVE_AZ[parent.type]} bərpa edin`);
        }

        await sql`UPDATE deletions SET restored_at = now(), restored_by = ${userId} WHERE id = ${deletionId}`.execute(trx);
        return batch.rows[0].counts;
    });
    refreshRatingsInBackground();
    return counts;
}

export interface DeletionListParams {
    type?: DeletionEntityType;
    search?: string;
    page: number;
    size: number;
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Active (not restored) batches, newest first. name/code/path come from the *_all tables. */
export async function listDeletions(params: DeletionListParams): Promise<{ data: DeletionListItem[]; totalCount: number }> {
    const search = params.search?.trim();
    const filters = [sql`d.restored_at IS NULL`];
    if (params.type) filters.push(sql`d.entity_type = ${params.type}`);
    if (search) {
        const escaped = escapeLike(search);
        filters.push(sql`(COALESCE(st.fullname, te.fullname, sc.name, di.name) ILIKE ${"%" + escaped + "%"}
                          OR COALESCE(st.code, te.code, sc.code, di.code)::text LIKE ${escaped + "%"})`);
    }
    const where = sql.join(filters, sql` AND `);

    const from = sql`
        FROM deletions d
        LEFT JOIN students_all  st ON d.entity_type = 'student'  AND st.id = d.entity_id
        LEFT JOIN teachers_all  te ON d.entity_type = 'teacher'  AND te.id = d.entity_id
        LEFT JOIN schools_all   sc ON d.entity_type = 'school'   AND sc.id = d.entity_id
        LEFT JOIN districts_all di ON d.entity_type = 'district' AND di.id = d.entity_id
        LEFT JOIN teachers_all  pt ON pt.id = st.teacher_id
        LEFT JOIN schools_all   ps ON ps.id = COALESCE(st.school_id, te.school_id)
        LEFT JOIN districts_all pd ON pd.id = COALESCE(st.district_id, te.district_id, sc.district_id)
        LEFT JOIN users u ON u.id = d.deleted_by
        WHERE ${where}
    `;

    const [countRes, rowsRes] = await Promise.all([
        sql<{ n: string }>`SELECT count(*)::text AS n ${from}`.execute(pg),
        sql<{
            id: number; entity_type: DeletionEntityType; entity_id: number; code: number | null; name: string | null;
            district_name: string | null; school_name: string | null; teacher_name: string | null;
            deleted_at: Date; user_id: number | null; user_email: string | null; counts: DeletionCounts;
        }>`
            SELECT d.id, d.entity_type, d.entity_id, d.deleted_at, d.counts,
                   COALESCE(st.code, te.code, sc.code, di.code) AS code,
                   COALESCE(st.fullname, te.fullname, sc.name, di.name) AS name,
                   pd.name AS district_name, ps.name AS school_name, pt.fullname AS teacher_name,
                   u.id AS user_id, u.email AS user_email
            ${from}
            ORDER BY d.deleted_at DESC, d.id DESC
            LIMIT ${params.size} OFFSET ${(params.page - 1) * params.size}
        `.execute(pg),
    ]);

    return {
        totalCount: Number(countRes.rows[0].n),
        data: rowsRes.rows.map((r) => ({
            id: Number(r.id),
            entityType: r.entity_type,
            entityId: Number(r.entity_id),
            code: r.code === null ? null : Number(r.code),
            name: r.name,
            path: { districtName: r.district_name, schoolName: r.school_name, teacherName: r.teacher_name },
            deletedAt: r.deleted_at,
            deletedBy: r.user_id === null ? null : { id: Number(r.user_id), email: r.user_email as string },
            counts: r.counts,
        })),
    };
}

type Db = Transaction<DB> | typeof pg;

/**
 * Create / update code checks (SOFT_DELETE_TASK.md §6.2): throws 409 if `code` is held by a hidden record of the
 * given type. Reads *_all, so the clash is reported before the UNIQUE constraint would fire with a cryptic message.
 */
export async function assertCodeNotDeleted(type: DeletionEntityType, code: number, db: Db = pg): Promise<void> {
    const table = ({ district: "districts_all", school: "schools_all", teacher: "teachers_all", student: "students_all" } as const)[type];
    const nameColumn = type === "student" || type === "teacher" ? "fullname" : "name";
    const res = await sql<{ name: string }>`
        SELECT ${sql.ref(nameColumn)} AS name FROM ${sql.table(table)} WHERE code = ${code} AND deleted_at IS NOT NULL
    `.execute(db);
    if (res.rows.length > 0) {
        throw httpError(409, `Bu kod silinmiş ${ENTITY_DATIVE_AZ[type]} məxsusdur (${res.rows[0].name}). «Silinənlər» bölməsindən bərpa edin.`);
    }
}
