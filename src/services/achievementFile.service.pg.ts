import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Kysely, Selectable } from "kysely";
import { pg } from "../config/pg";
import { JWT_SECRET } from "../config/env";
import type { AchievementFiles, DB } from "../types/db";
import { isAdminLike } from "../utils/avatar.util";

/** Files attached to the "Uğurlar" block of a teacher/school profile (UGURLAR_FILES_TASK.md).
 *  Same values as profile_change_requests.entity_type — a file op travels in the payload of the
 *  entity's pending request under `achievementFiles`. */
export type AchievementEntityType = "teacher" | "school";
export type AchievementAccess = "admin" | "owner";
export type AchievementFileMime = "application/pdf" | "image/jpeg" | "image/png";

export const ACHIEVEMENT_FILE_LIMIT = 20;
export const ACHIEVEMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface AchievementFileOps {
    add: number[];
    remove: number[];
}

export interface AchievementFileDto {
    id: number;
    originalName: string;
    mimeType: AchievementFileMime;
    sizeBytes: number;
    status: "pending" | "approved";
    /** Always false for anyone but the owner/admin. */
    pendingRemoval: boolean;
    uploadedAt: string;
    fileUrl: string;
    downloadUrl: string;
    thumbUrl: string | null;
}

type FileRow = Selectable<AchievementFiles>;
type Db = Kysely<DB>;

/** Business-rule failure with the HTTP status the controller should answer with. */
export class AchievementFileError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

const ENTITY_FOLDER: Record<AchievementEntityType, string> = { teacher: "teachers", school: "schools" };
const OWNER_COLUMN = { teacher: "teacher_id", school: "school_id" } as const;
const ENTITY_TABLE = { teacher: "teachers", school: "schools" } as const;

export function parseAchievementEntityType(raw: unknown): AchievementEntityType | null {
    return raw === "teacher" || raw === "school" ? raw : null;
}

export function parseAchievementEntityId(raw: unknown): number | null {
    if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw)) return null;
    const id = parseInt(raw, 10);
    return id > 0 ? id : null;
}

/** uploads/achievements/<teachers|schools>/<entityId>/ — outside the public static prefix (see index.ts). */
export function achievementDir(entityType: AchievementEntityType, entityId: number): string {
    return path.resolve(process.cwd(), "uploads", "achievements", ENTITY_FOLDER[entityType], String(entityId));
}

function thumbName(storageName: string): string {
    return storageName.replace(/\.[^.]+$/, "") + "_thumb.jpg";
}

/**
 * admin-like roles manage any profile; a teacher account only its own; a school director only its
 * own school (not the teachers of the school — owner's decision 19.10.2026).
 */
export function canManageAchievementFiles(
    user: { role?: string; teacherId?: string; schoolId?: string } | undefined,
    entityType: AchievementEntityType,
    entityId: number
): AchievementAccess | null {
    if (isAdminLike(user?.role)) return "admin";
    if (entityType === "teacher" && user?.role === "teacher" && user.teacherId === String(entityId)) return "owner";
    if (entityType === "school" && user?.role === "schoolDirector" && user.schoolId === String(entityId)) return "owner";
    return null;
}

export async function achievementEntityExists(entityType: AchievementEntityType, entityId: number): Promise<boolean> {
    const row = await pg.selectFrom(ENTITY_TABLE[entityType]).select("id").where("id", "=", entityId).executeTakeFirst();
    return !!row;
}

export async function countEntityFiles(db: Db, entityType: AchievementEntityType, entityId: number): Promise<number> {
    const row = await db
        .selectFrom("achievement_files")
        .select((eb) => eb.fn.countAll().as("count"))
        .where(OWNER_COLUMN[entityType], "=", entityId)
        .executeTakeFirstOrThrow();
    return Number(row.count);
}

/* ------------------------------------------------------------------ signed links (UGURLAR_FILES_TASK.md Р4) */

let signingKey: Buffer | null = null;

function getSigningKey(): Buffer {
    if (!signingKey) signingKey = crypto.createHmac("sha256", JWT_SECRET).update("achievement-files").digest();
    return signingKey;
}

function sign(id: number, v: string, d: string, exp: number): string {
    return crypto.createHmac("sha256", getSigningKey()).update(`${id}.${v}.${d}.${exp}`).digest("hex");
}

/** True when `sig` is the valid, unexpired signature for the given link parameters. */
export function verifyContentSignature(id: number, v: string, d: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(sign(id, v, d, exp), "hex");
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function signedUrl(id: number, v: "file" | "thumb", d: "0" | "1"): string {
    // End of the NEXT hour: links stay byte-identical within an hour (browser caches thumbnails)
    // and still live at least an hour.
    const exp = (Math.floor(Date.now() / 3600000) + 2) * 3600;
    return `/api/achievement-files/${id}/content?v=${v}&d=${d}&exp=${exp}&sig=${sign(id, v, d, exp)}`;
}

function toDto(row: FileRow, pendingRemoval: boolean): AchievementFileDto {
    return {
        id: row.id,
        originalName: row.original_name,
        mimeType: row.mime_type as AchievementFileMime,
        sizeBytes: row.size_bytes,
        status: row.status as "pending" | "approved",
        pendingRemoval,
        uploadedAt: new Date(row.uploaded_at).toISOString(),
        fileUrl: signedUrl(row.id, "file", "0"),
        downloadUrl: signedUrl(row.id, "file", "1"),
        thumbUrl: row.has_thumbnail ? signedUrl(row.id, "thumb", "0") : null,
    };
}

function entityOfRow(row: FileRow): { entityType: AchievementEntityType; entityId: number } {
    return row.teacher_id != null
        ? { entityType: "teacher", entityId: row.teacher_id }
        : { entityType: "school", entityId: row.school_id! };
}

/** Absolute path of a stored file (or its thumbnail) — built from DB values, never from the request. */
export function achievementFilePath(row: FileRow, thumb: boolean): string {
    const { entityType, entityId } = entityOfRow(row);
    return path.join(achievementDir(entityType, entityId), thumb ? thumbName(row.storage_name) : row.storage_name);
}

export async function getAchievementFileById(id: number): Promise<FileRow | null> {
    return (await pg.selectFrom("achievement_files").selectAll().where("id", "=", id).executeTakeFirst()) ?? null;
}

/* ------------------------------------------------------------------ disk */

/** Best-effort: a leftover file on disk is garbage, a failed request is worse. */
function unlinkQuiet(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch (err: any) {
        if (err?.code !== "ENOENT") console.error("[ACHIEVEMENT FILES] unlink failed:", filePath, err);
    }
}

export function removeFilesFromDisk(rows: FileRow[]): void {
    for (const row of rows) {
        unlinkQuiet(achievementFilePath(row, false));
        if (row.has_thumbnail) unlinkQuiet(achievementFilePath(row, true));
    }
}

/** Entity deleted: its rows go with the FK cascade, the directory is ours to remove. */
export function removeAchievementDirs(entityType: AchievementEntityType, entityIds: number[]): void {
    for (const id of entityIds) {
        try {
            fs.rmSync(achievementDir(entityType, id), { recursive: true, force: true });
        } catch (err) {
            console.error("[ACHIEVEMENT FILES] failed to remove directory of", entityType, id, err);
        }
    }
}

/* ------------------------------------------------------------------ pending request file ops (Р1) */

export function readFileOps(payload: unknown): AchievementFileOps {
    const raw = (payload as any)?.achievementFiles;
    const ids = (list: unknown): number[] => (Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n)) : []);
    return { add: ids(raw?.add), remove: ids(raw?.remove) };
}

async function lockPending(db: Db, entityType: AchievementEntityType, entityId: number) {
    return await db
        .selectFrom("profile_change_requests")
        .selectAll()
        .where("entity_type", "=", entityType)
        .where("entity_id", "=", entityId)
        .where("status", "=", "pending")
        .forUpdate()
        .executeTakeFirst();
}

/**
 * Records a file op in the entity's pending request, creating the request if there is none.
 * Must run inside the caller's transaction. Bumps submitted_at: approve compares it with the
 * admin's expectedSubmittedAt (Р6), so an upload made while the admin was reading is not
 * approved unseen.
 */
export async function addFileOp(
    trx: Db,
    entityType: AchievementEntityType,
    entityId: number,
    op: "add" | "remove",
    fileId: number,
    submittedBy: number
): Promise<void> {
    const existing = await lockPending(trx, entityType, entityId);

    if (!existing) {
        const ops: AchievementFileOps = { add: [], remove: [] };
        ops[op].push(fileId);
        await trx
            .insertInto("profile_change_requests")
            .values({
                entity_type: entityType,
                entity_id: entityId,
                payload: JSON.stringify({ achievementFiles: ops }),
                submitted_by: submittedBy,
            })
            .execute();
        return;
    }

    const ops = readFileOps(existing.payload);
    if (!ops[op].includes(fileId)) ops[op].push(fileId);
    await trx
        .updateTable("profile_change_requests")
        .set({
            payload: JSON.stringify({ ...(existing.payload as Record<string, any>), achievementFiles: ops }),
            submitted_by: submittedBy,
            submitted_at: new Date(),
        })
        .where("id", "=", existing.id)
        .execute();
}

/**
 * Drops a file id from the pending request (both lists, or just `remove` for cancel-removal).
 * A request left without any text field and without file ops would sit in the queue as an empty
 * card, so it is deleted.
 */
export async function stripFileFromPending(
    db: Db,
    entityType: AchievementEntityType,
    entityId: number,
    fileId: number,
    lists: Array<"add" | "remove"> = ["add", "remove"]
): Promise<void> {
    const existing = await lockPending(db, entityType, entityId);
    if (!existing) return;

    const ops = readFileOps(existing.payload);
    let changed = false;
    for (const list of lists) {
        const filtered = ops[list].filter((n) => n !== fileId);
        if (filtered.length !== ops[list].length) {
            ops[list] = filtered;
            changed = true;
        }
    }
    if (!changed) return;

    const { achievementFiles: _old, ...rest } = existing.payload as Record<string, any>;
    const payload: Record<string, any> = ops.add.length > 0 || ops.remove.length > 0 ? { ...rest, achievementFiles: ops } : rest;

    if (Object.keys(payload).length === 0) {
        await db.deleteFrom("profile_change_requests").where("id", "=", existing.id).execute();
        return;
    }
    await db
        .updateTable("profile_change_requests")
        .set({ payload: JSON.stringify(payload), submitted_at: new Date() })
        .where("id", "=", existing.id)
        .execute();
}

/**
 * Approve: `add` rows become visible, `remove` rows are deleted. Both filtered by the entity —
 * ids in a payload are never trusted to belong to it. Returns the deleted rows; the caller
 * unlinks them from disk after the transaction commits.
 */
export async function applyApprovedFileOps(
    trx: Db,
    entityType: AchievementEntityType,
    entityId: number,
    ops: AchievementFileOps,
    adminUserId: number
): Promise<FileRow[]> {
    const column = OWNER_COLUMN[entityType];
    if (ops.add.length > 0) {
        await trx
            .updateTable("achievement_files")
            .set({ status: "approved", approved_by: adminUserId, approved_at: new Date() })
            .where("id", "in", ops.add)
            .where(column, "=", entityId)
            .where("status", "=", "pending")
            .execute();
    }
    if (ops.remove.length === 0) return [];
    return await trx.deleteFrom("achievement_files").where("id", "in", ops.remove).where(column, "=", entityId).returningAll().execute();
}

/** Reject: files proposed for adding are discarded for good; removal requests are simply dropped. */
export async function discardRejectedFileOps(
    trx: Db,
    entityType: AchievementEntityType,
    entityId: number,
    ops: AchievementFileOps
): Promise<FileRow[]> {
    if (ops.add.length === 0) return [];
    return await trx
        .deleteFrom("achievement_files")
        .where("id", "in", ops.add)
        .where(OWNER_COLUMN[entityType], "=", entityId)
        .where("status", "=", "pending")
        .returningAll()
        .execute();
}

/* ------------------------------------------------------------------ list / create / delete */

export async function listAchievementFiles(
    entityType: AchievementEntityType,
    entityId: number,
    access: AchievementAccess | null
): Promise<AchievementFileDto[]> {
    let query = pg.selectFrom("achievement_files").selectAll().where(OWNER_COLUMN[entityType], "=", entityId);
    if (!access) query = query.where("status", "=", "approved");
    const rows = await query.orderBy("uploaded_at", "asc").orderBy("id", "asc").execute();

    let pendingRemoval = new Set<number>();
    if (access) {
        const pending = await pg
            .selectFrom("profile_change_requests")
            .select("payload")
            .where("entity_type", "=", entityType)
            .where("entity_id", "=", entityId)
            .where("status", "=", "pending")
            .executeTakeFirst();
        if (pending) pendingRemoval = new Set(readFileOps(pending.payload).remove);
    }
    return rows.map((row) => toDto(row, pendingRemoval.has(row.id)));
}

/** DTOs by id (any status) for the moderation queue — admin-only caller, so links are safe to issue. */
export async function loadFileDtosByIds(ids: number[]): Promise<Map<number, AchievementFileDto>> {
    if (ids.length === 0) return new Map();
    const rows = await pg.selectFrom("achievement_files").selectAll().where("id", "in", ids).execute();
    return new Map(rows.map((row) => [row.id, toDto(row, false)]));
}

export interface CreateAchievementFileParams {
    entityType: AchievementEntityType;
    entityId: number;
    access: AchievementAccess;
    userId: number;
    storageName: string;
    originalName: string;
    mimeType: AchievementFileMime;
    sizeBytes: number;
    hasThumbnail: boolean;
}

/**
 * The entity row lock serialises concurrent uploads, so the 20-file limit cannot be overrun by a
 * race. An admin's file is approved at once; an owner's goes pending and into the entity's request.
 */
export async function createAchievementFile(params: CreateAchievementFileParams): Promise<AchievementFileDto> {
    const { entityType, entityId, access, userId } = params;
    return await pg.transaction().execute(async (trx) => {
        const owner = await trx.selectFrom(ENTITY_TABLE[entityType]).select("id").where("id", "=", entityId).forUpdate().executeTakeFirst();
        if (!owner) throw new AchievementFileError(404, "Profil tapılmadı");

        if ((await countEntityFiles(trx, entityType, entityId)) >= ACHIEVEMENT_FILE_LIMIT) {
            throw new AchievementFileError(409, `Maksimum ${ACHIEVEMENT_FILE_LIMIT} fayl yükləmək olar`);
        }

        const approvedNow = access === "admin";
        const row = await trx
            .insertInto("achievement_files")
            .values({
                teacher_id: entityType === "teacher" ? entityId : null,
                school_id: entityType === "school" ? entityId : null,
                storage_name: params.storageName,
                original_name: params.originalName,
                mime_type: params.mimeType,
                size_bytes: params.sizeBytes,
                has_thumbnail: params.hasThumbnail,
                status: approvedNow ? "approved" : "pending",
                uploaded_by: userId,
                approved_by: approvedNow ? userId : null,
                approved_at: approvedNow ? new Date() : null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        if (!approvedNow) await addFileOp(trx, entityType, entityId, "add", row.id, userId);
        return toDto(row, false);
    });
}

/**
 * Delete (Р2): admin, or the owner of a still-unapproved file — immediately; the owner of an
 * approved file — a removal request. Returns whether the removal is only requested.
 * The pending request is locked before the file row, in the same order approve takes them, so the
 * two cannot deadlock.
 */
export async function deleteAchievementFile(
    file: FileRow,
    access: AchievementAccess,
    userId: number
): Promise<{ pending: boolean }> {
    const { entityType, entityId } = entityOfRow(file);
    const result = await pg.transaction().execute(async (trx) => {
        await lockPending(trx, entityType, entityId);
        const fresh = await trx.selectFrom("achievement_files").selectAll().where("id", "=", file.id).forUpdate().executeTakeFirst();
        if (!fresh) throw new AchievementFileError(404, "Fayl tapılmadı");

        if (access === "admin" || fresh.status === "pending") {
            await stripFileFromPending(trx, entityType, entityId, fresh.id);
            await trx.deleteFrom("achievement_files").where("id", "=", fresh.id).execute();
            return { pending: false, removed: fresh };
        }
        await addFileOp(trx, entityType, entityId, "remove", fresh.id, userId);
        return { pending: true, removed: null };
    });
    if (result.removed) removeFilesFromDisk([result.removed]);
    return { pending: result.pending };
}

export async function cancelAchievementFileRemoval(file: FileRow): Promise<void> {
    const { entityType, entityId } = entityOfRow(file);
    await pg.transaction().execute((trx) => stripFileFromPending(trx, entityType, entityId, file.id, ["remove"]));
}

export function accessForFile(user: Parameters<typeof canManageAchievementFiles>[0], file: FileRow): AchievementAccess | null {
    const { entityType, entityId } = entityOfRow(file);
    return canManageAchievementFiles(user, entityType, entityId);
}
