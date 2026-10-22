import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { ResponseHandler } from "../utils/response-handler.util";
import {
    ACHIEVEMENT_FILE_LIMIT,
    AchievementAccess,
    AchievementEntityType,
    AchievementFileError,
    AchievementFileMime,
    accessForFile,
    achievementEntityExists,
    achievementFilePath,
    cancelAchievementFileRemoval,
    canManageAchievementFiles,
    countEntityFiles,
    createAchievementFile,
    deleteAchievementFile,
    getAchievementFileById,
    listAchievementFiles,
    parseAchievementEntityId,
    parseAchievementEntityType,
    verifyContentSignature,
} from "../services/achievementFile.service.pg";
import { pg } from "../config/pg";

interface AchievementTarget {
    entityType: AchievementEntityType;
    entityId: number;
    access: AchievementAccess;
}

/** Real type of the file by its first bytes — the client-declared mimetype is only a hint. */
function sniffMime(filePath: string): AchievementFileMime | null {
    const head = Buffer.alloc(8);
    const fd = fs.openSync(filePath, "r");
    let read: number;
    try {
        read = fs.readSync(fd, head, 0, 8, 0);
    } finally {
        fs.closeSync(fd);
    }
    if (read >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
    if (read >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (read >= 8 && head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    return null;
}

/** Multer decodes the name per the charset we set; this only strips what must not reach the DB/headers. */
function cleanOriginalName(raw: string, fallbackExt: string): string {
    const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
    return base || `fayl${fallbackExt}`;
}

function asciiFallback(name: string): string {
    return name.replace(/[^\x20-\x7e]|["\\]/g, "_");
}

function rfc5987(name: string): string {
    return encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Gate in front of multer: rights, entity existence and the limit are checked BEFORE a byte is
 * written to disk, so an anonymous/foreign request leaves nothing behind (backend CLAUDE.md,
 * "Request body limit"). The authoritative limit check is repeated under the entity lock in
 * createAchievementFile.
 */
export const requireAchievementManager = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const entityType = parseAchievementEntityType(req.params.entityType);
        const entityId = parseAchievementEntityId(req.params.entityId);
        if (!entityType || !entityId) {
            res.status(400).json(ResponseHandler.badRequest("entityType/entityId düzgün deyil"));
            return;
        }

        const access = canManageAchievementFiles(req.user, entityType, entityId);
        if (!access) {
            res.status(403).json(ResponseHandler.error("Bu əməliyyat üçün icazəniz yoxdur"));
            return;
        }
        if (!(await achievementEntityExists(entityType, entityId))) {
            res.status(404).json(ResponseHandler.notFound("Profil tapılmadı"));
            return;
        }
        if ((await countEntityFiles(pg, entityType, entityId)) >= ACHIEVEMENT_FILE_LIMIT) {
            res.status(409).json(ResponseHandler.conflict(`Maksimum ${ACHIEVEMENT_FILE_LIMIT} fayl yükləmək olar`));
            return;
        }

        res.locals.achievementTarget = { entityType, entityId, access } satisfies AchievementTarget;
        next();
    } catch (error) {
        next(error);
    }
};

export class AchievementFileController {
    list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const entityType = parseAchievementEntityType(req.params.entityType);
            const entityId = parseAchievementEntityId(req.params.entityId);
            if (!entityType || !entityId) {
                res.status(400).json(ResponseHandler.badRequest("entityType/entityId düzgün deyil"));
                return;
            }
            if (!(await achievementEntityExists(entityType, entityId))) {
                res.status(404).json(ResponseHandler.notFound("Profil tapılmadı"));
                return;
            }

            const access = canManageAchievementFiles(req.user, entityType, entityId);
            const files = await listAchievementFiles(entityType, entityId, access);
            res.json(ResponseHandler.success({ files, canManage: access !== null, limit: ACHIEVEMENT_FILE_LIMIT }));
        } catch (error) {
            next(error);
        }
    };

    upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const file = req.file;
        const written: string[] = [];
        const cleanup = () => {
            for (const p of written) {
                try {
                    fs.unlinkSync(p);
                } catch {
                    // already gone
                }
            }
        };

        try {
            if (!file) {
                res.status(400).json(ResponseHandler.badRequest("Fayl seçilməyib"));
                return;
            }
            written.push(file.path);
            const target = res.locals.achievementTarget as AchievementTarget;

            const declared = file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype;
            const mimeType = sniffMime(file.path);
            if (!mimeType || mimeType !== declared) {
                cleanup();
                res.status(400).json(ResponseHandler.badRequest("Yalnız PDF, JPG və PNG faylları qəbul edilir"));
                return;
            }

            let hasThumbnail = false;
            if (mimeType !== "application/pdf") {
                const thumbPath = path.join(path.dirname(file.path), path.basename(file.filename, path.extname(file.filename)) + "_thumb.jpg");
                try {
                    await sharp(file.path)
                        .rotate()
                        .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
                        .flatten({ background: "#ffffff" })
                        .jpeg({ quality: 75 })
                        .toFile(thumbPath);
                    written.push(thumbPath);
                    hasThumbnail = true;
                } catch {
                    cleanup();
                    res.status(400).json(ResponseHandler.badRequest("Şəkil faylı oxunmur"));
                    return;
                }
            }

            const dto = await createAchievementFile({
                entityType: target.entityType,
                entityId: target.entityId,
                access: target.access,
                userId: parseInt(req.user!.userId, 10),
                storageName: file.filename,
                originalName: cleanOriginalName(file.originalname, path.extname(file.filename)),
                mimeType,
                sizeBytes: file.size,
                hasThumbnail,
            });

            if (target.access === "admin") {
                res.status(201).json(ResponseHandler.created(dto, "Fayl əlavə olundu"));
            } else {
                res.status(202).json(ResponseHandler.success(dto, "Fayl yükləndi. Admin təsdiqindən sonra profildə görünəcək"));
            }
        } catch (error) {
            cleanup();
            if (error instanceof AchievementFileError) {
                res.status(error.status).json(ResponseHandler.error(error.message));
                return;
            }
            next(error);
        }
    };

    remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = parseAchievementEntityId(req.params.id);
            const file = id ? await getAchievementFileById(id) : null;
            if (!file) {
                res.status(404).json(ResponseHandler.notFound("Fayl tapılmadı"));
                return;
            }
            const access = accessForFile(req.user, file);
            if (!access) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat üçün icazəniz yoxdur"));
                return;
            }

            const { pending } = await deleteAchievementFile(file, access, parseInt(req.user!.userId, 10));
            if (pending) {
                res.status(202).json(ResponseHandler.success({ pending: true }, "Silinmə admin təsdiqinə göndərildi"));
            } else {
                res.json(ResponseHandler.deleted("Fayl silindi"));
            }
        } catch (error) {
            if (error instanceof AchievementFileError) {
                res.status(error.status).json(ResponseHandler.error(error.message));
                return;
            }
            next(error);
        }
    };

    cancelRemoval = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = parseAchievementEntityId(req.params.id);
            const file = id ? await getAchievementFileById(id) : null;
            if (!file) {
                res.status(404).json(ResponseHandler.notFound("Fayl tapılmadı"));
                return;
            }
            if (!accessForFile(req.user, file)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat üçün icazəniz yoxdur"));
                return;
            }

            await cancelAchievementFileRemoval(file);
            res.json(ResponseHandler.success({ cancelled: true }, "Silinmə sorğusu ləğv edildi"));
        } catch (error) {
            next(error);
        }
    };

    /**
     * Unauthenticated by design: the HMAC link (issued only by the list endpoint to viewers allowed
     * to see the file) is the authorization, so <img src>/<a href> work without a Bearer header.
     * The path comes from the DB row, never from the query.
     */
    content = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = parseAchievementEntityId(req.params.id);
            const v = String(req.query.v ?? "");
            const d = String(req.query.d ?? "");
            const exp = Number(req.query.exp);
            const sig = String(req.query.sig ?? "");
            if (!id || (v !== "file" && v !== "thumb") || (d !== "0" && d !== "1") || !/^[0-9a-f]{64}$/.test(sig)
                || !verifyContentSignature(id, v, d, exp, sig)) {
                res.status(403).json(ResponseHandler.error("Keçid etibarsızdır və ya müddəti bitib"));
                return;
            }

            const file = await getAchievementFileById(id);
            if (!file || (v === "thumb" && !file.has_thumbnail)) {
                res.status(404).json(ResponseHandler.notFound("Fayl tapılmadı"));
                return;
            }
            const absolute = achievementFilePath(file, v === "thumb");
            if (!fs.existsSync(absolute)) {
                res.status(404).json(ResponseHandler.notFound("Fayl tapılmadı"));
                return;
            }

            res.setHeader("Content-Type", v === "thumb" ? "image/jpeg" : file.mime_type);
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.setHeader(
                "Content-Disposition",
                `${d === "1" ? "attachment" : "inline"}; filename="${asciiFallback(file.original_name)}"; filename*=UTF-8''${rfc5987(file.original_name)}`
            );
            res.sendFile(absolute, { cacheControl: false }, (err) => {
                if (err && !res.headersSent) next(err);
            });
        } catch (error) {
            next(error);
        }
    };
}

const achievementFileController = new AchievementFileController();
export const listAchievementFilesHandler = achievementFileController.list;
export const uploadAchievementFileHandler = achievementFileController.upload;
export const deleteAchievementFileHandler = achievementFileController.remove;
export const cancelAchievementFileRemovalHandler = achievementFileController.cancelRemoval;
export const serveAchievementFileContent = achievementFileController.content;
