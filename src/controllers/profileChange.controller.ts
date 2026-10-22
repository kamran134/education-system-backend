import { Request, Response, NextFunction } from "express";
import { profileChangeRequestServicePg, ProfileChangeEntityType, ProfileChangeStatus } from "../services/profileChangeRequest.service.pg";
import { isAdminLike, canRequestStudentProfileChange } from "../utils/avatar.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { SchoolUseCase } from "../usecases/school.usecase";
import { SchoolServicePg } from "../services/school.service.pg";
import { TeacherUseCase } from "../usecases/teacher.usecase";
import { TeacherServicePg } from "../services/teacher.service.pg";
import { DistrictUseCase } from "../usecases/district.usecase";
import { DistrictServicePg } from "../services/district.service.pg";
import { StudentUseCase } from "../usecases/student.usecase";
import { StudentServicePg } from "../services/student.service.pg";
import { pg } from "../config/pg";
import { applyApprovedFileOps, discardRejectedFileOps, readFileOps, removeFilesFromDisk } from "../services/achievementFile.service.pg";

const VALID_ENTITY_TYPES: ProfileChangeEntityType[] = ["school", "teacher", "district", "student"];

/** entityType сущности → поле req.user, которым владелец подтверждает, что заявка его.
 *  Для student не применимо — заявку подаёт не сама сущность (ученик), а его учитель, там
 *  владение проверяет canRequestStudentProfileChange (требует похода в БД, поэтому асинхронно
 *  и отдельно, см. isOwner ниже). */
function ownEntityIdFor(entityType: "school" | "teacher" | "district", user: Request["user"]): string | undefined {
    if (entityType === "school") return user?.schoolId;
    if (entityType === "teacher") return user?.teacherId;
    return user?.districtId;
}

/** Владелец заявки: для school/teacher/district — сравнение с полем токена, для student —
 *  поход в БД за teacher_id ученика (см. avatar.util.ts). */
async function isOwner(entityType: ProfileChangeEntityType, entityId: number, user: Request["user"]): Promise<boolean> {
    if (entityType === "student") return canRequestStudentProfileChange(user, String(entityId));
    return ownEntityIdFor(entityType, user) === String(entityId);
}

export class ProfileChangeController {
    private schoolUseCase = new SchoolUseCase(new SchoolServicePg());
    private teacherUseCase = new TeacherUseCase(new TeacherServicePg());
    private districtUseCase = new DistrictUseCase(new DistrictServicePg());
    private studentUseCase = new StudentUseCase(new StudentServicePg());

    /** Все три — только admin-подобные роли (BASE_FIXES_TASK.md §2.5/§2.7): очередь целиком,
     *  счётчик и список id с pending раскрывают, что изменил владелец, до подтверждения —
     *  ровно то, что не должно быть видно никому, кроме владельца и админа. */
    listQueue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!isAdminLike(req.user?.role)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat yalnız administratora aiddir"));
                return;
            }
            const status = (req.query.status as ProfileChangeStatus) || "pending";
            const rows = await profileChangeRequestServicePg.listQueue(status);
            res.json(ResponseHandler.success(rows));
        } catch (error) {
            next(error);
        }
    };

    count = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!isAdminLike(req.user?.role)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat yalnız administratora aiddir"));
                return;
            }
            const pending = await profileChangeRequestServicePg.count();
            res.json(ResponseHandler.success({ pending }));
        } catch (error) {
            next(error);
        }
    };

    pendingIds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!isAdminLike(req.user?.role)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat yalnız administratora aiddir"));
                return;
            }
            const entityType = req.query.entityType as ProfileChangeEntityType;
            if (!VALID_ENTITY_TYPES.includes(entityType)) {
                res.status(400).json(ResponseHandler.badRequest("entityType düzgün deyil"));
                return;
            }
            const ids = await profileChangeRequestServicePg.pendingIds(entityType);
            res.json(ResponseHandler.success(ids));
        } catch (error) {
            next(error);
        }
    };

    /**
     * Единственная точка, откуда pending-заявка видна не-админу — и только владельцу этой
     * же сущности (BASE_FIXES_TASK.md §2.5). Всем остальным — 403, а не пустой ответ:
     * пустой ответ выглядел бы как «заявки нет», что неправда и может ввести в заблуждение.
     */
    current = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const entityType = req.query.entityType as ProfileChangeEntityType;
            const entityId = parseInt(req.query.entityId as string, 10);
            if (!VALID_ENTITY_TYPES.includes(entityType) || isNaN(entityId)) {
                res.status(400).json(ResponseHandler.badRequest("entityType/entityId düzgün deyil"));
                return;
            }

            const owner = await isOwner(entityType, entityId, req.user);
            if (!isAdminLike(req.user?.role) && !owner) {
                res.status(403).json(ResponseHandler.error("Bu məlumatlara icazəniz yoxdur"));
                return;
            }

            const pending = await profileChangeRequestServicePg.getCurrentPending(entityType, entityId);
            res.json(ResponseHandler.success(pending));
        } catch (error) {
            next(error);
        }
    };

    approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!isAdminLike(req.user?.role)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat yalnız administratora aiddir"));
                return;
            }

            const id = parseInt(req.params.id, 10);
            const pending = await profileChangeRequestServicePg.getPendingById(id);
            if (!pending) {
                res.status(404).json(ResponseHandler.notFound("Təsdiq gözləyən məlumat tapılmadı (artıq baxılıb?)"));
                return;
            }

            // Р6 (UGURLAR_FILES_TASK.md): the admin approves what they saw. If the owner touched the
            // files after that (submitted_at moved), refuse instead of approving an unseen upload.
            // Without the field the old behaviour stays (text-only requests, older clients).
            const rawExpected = req.body?.expectedSubmittedAt;
            const expectedMs = rawExpected === undefined || rawExpected === null ? null : new Date(rawExpected).getTime();
            if (expectedMs !== null && isNaN(expectedMs)) {
                res.status(400).json(ResponseHandler.badRequest("expectedSubmittedAt düzgün deyil"));
                return;
            }
            const staleMessage = "Məlumat bu arada yenilənib. Səhifəni yeniləyib yenidən baxın";
            if (expectedMs !== null && expectedMs !== pending.submittedAt.getTime()) {
                res.status(409).json(ResponseHandler.conflict(staleMessage));
                return;
            }

            // «Düzəliş et»: admin göndərilən dəyərləri özü düzəldib təsdiqləyə bilər — body-də
            // payload gələrsə, əsl tətbiq olunan dəyər odur, pending.payload deyil.
            const source = req.body?.payload ?? pending.payload;
            if (typeof source !== "object" || Array.isArray(source)) {
                res.status(400).json(ResponseHandler.badRequest("payload düzgün deyil"));
                return;
            }
            // Files are NEVER taken from the body or applied as a profile field: they are
            // approved from the re-read pending request below, by id, filtered by entity.
            const { achievementFiles: _files, ...finalPayload } = source as Record<string, any>;
            const adminUserId = parseInt(req.user!.userId, 10);

            if (pending.entityType === "school") {
                if (Object.keys(finalPayload).length > 0) {
                    await this.schoolUseCase.updateSchoolProfile(String(pending.entityId), finalPayload, adminUserId);
                }
            } else if (pending.entityType === "teacher") {
                if (Object.keys(finalPayload).length > 0) {
                    await this.teacherUseCase.updateTeacherProfile(String(pending.entityId), finalPayload, adminUserId);
                }
            } else if (pending.entityType === "district") {
                await this.districtUseCase.updateDistrictProfile(String(pending.entityId), finalPayload);
            } else {
                // updateStudentProfile сам вырезает лишние поля (fullname только) — даже если
                // finalPayload пришёл из body admin-запроса «Düzəliş et» с чем-то посторонним,
                // через модерацию не должно проходить ничего, кроме имени.
                await this.studentUseCase.updateStudentProfile(String(pending.entityId), finalPayload);
            }

            if (pending.entityType !== "school" && pending.entityType !== "teacher") {
                const updated = await profileChangeRequestServicePg.markReviewed(id, "approved", adminUserId, null, finalPayload);
                res.json(ResponseHandler.updated(updated, "Məlumatlar təsdiqləndi"));
                return;
            }

            // File part and the verdict in one transaction. The request is re-read under a row lock:
            // the owner's upload takes the same lock, so what is approved is exactly this state.
            // The text part above has no lock on purpose (the profile update runs on its own
            // connection; holding the request lock across it could deadlock against an upload).
            // If a file op slips in between and the re-check fails, the text stays applied — it is
            // idempotent and the request is still pending for the next, informed, approve.
            const entityType = pending.entityType;
            const outcome = await pg.transaction().execute(async (trx) => {
                const fresh = await profileChangeRequestServicePg.getPendingByIdForUpdate(trx, id);
                if (!fresh) return { kind: "notFound" as const };
                if (expectedMs !== null && expectedMs !== fresh.submittedAt.getTime()) return { kind: "stale" as const };

                const ops = readFileOps(fresh.payload);
                const removed = await applyApprovedFileOps(trx, entityType, pending.entityId, ops, adminUserId);
                const hasOps = ops.add.length > 0 || ops.remove.length > 0;
                const history = hasOps ? { ...finalPayload, achievementFiles: ops } : finalPayload;
                const updated = await profileChangeRequestServicePg.markReviewed(id, "approved", adminUserId, null, history, trx);
                return updated ? { kind: "ok" as const, updated, removed } : { kind: "notFound" as const };
            });

            if (outcome.kind === "notFound") {
                res.status(404).json(ResponseHandler.notFound("Təsdiq gözləyən məlumat tapılmadı (artıq baxılıb?)"));
                return;
            }
            if (outcome.kind === "stale") {
                res.status(409).json(ResponseHandler.conflict(staleMessage));
                return;
            }
            removeFilesFromDisk(outcome.removed);
            res.json(ResponseHandler.updated(outcome.updated, "Məlumatlar təsdiqləndi"));
        } catch (error) {
            next(error);
        }
    };

    reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!isAdminLike(req.user?.role)) {
                res.status(403).json(ResponseHandler.error("Bu əməliyyat yalnız administratora aiddir"));
                return;
            }

            const id = parseInt(req.params.id, 10);
            const adminUserId = parseInt(req.user!.userId, 10);
            const reviewNote: string | null = req.body?.reviewNote ?? null;

            // Pending files proposed for adding are deleted in the same transaction as the verdict
            // (disk after commit); removal requests are just dropped, those files stay (Р3).
            const result = await pg.transaction().execute(async (trx) => {
                const updated = await profileChangeRequestServicePg.markReviewed(id, "rejected", adminUserId, reviewNote, undefined, trx);
                if (!updated) return null;
                const discarded = updated.entityType === "school" || updated.entityType === "teacher"
                    ? await discardRejectedFileOps(trx, updated.entityType, updated.entityId, readFileOps(updated.payload))
                    : [];
                return { updated, discarded };
            });
            if (!result) {
                res.status(404).json(ResponseHandler.notFound("Təsdiq gözləyən məlumat tapılmadı (artıq baxılıb?)"));
                return;
            }

            removeFilesFromDisk(result.discarded);
            res.json(ResponseHandler.updated(result.updated, "Məlumatlar rədd edildi"));
        } catch (error) {
            next(error);
        }
    };
}

const profileChangeController = new ProfileChangeController();
export const listProfileChangeQueue = profileChangeController.listQueue;
export const getProfileChangeCount = profileChangeController.count;
export const getProfileChangePendingIds = profileChangeController.pendingIds;
export const getCurrentProfileChange = profileChangeController.current;
export const approveProfileChange = profileChangeController.approve;
export const rejectProfileChange = profileChangeController.reject;
