import { Request, Response, NextFunction } from "express";
import { profileChangeRequestServicePg, ProfileChangeEntityType, ProfileChangeStatus } from "../services/profileChangeRequest.service.pg";
import { isAdminLike } from "../utils/avatar.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { SchoolUseCase } from "../usecases/school.usecase";
import { SchoolServicePg } from "../services/school.service.pg";
import { TeacherUseCase } from "../usecases/teacher.usecase";
import { TeacherServicePg } from "../services/teacher.service.pg";
import { DistrictUseCase } from "../usecases/district.usecase";
import { DistrictServicePg } from "../services/district.service.pg";

const VALID_ENTITY_TYPES: ProfileChangeEntityType[] = ["school", "teacher", "district"];

/** entityType сущности → поле req.user, которым владелец подтверждает, что заявка его. */
function ownEntityIdFor(entityType: ProfileChangeEntityType, user: Request["user"]): string | undefined {
    if (entityType === "school") return user?.schoolId;
    if (entityType === "teacher") return user?.teacherId;
    return user?.districtId;
}

export class ProfileChangeController {
    private schoolUseCase = new SchoolUseCase(new SchoolServicePg());
    private teacherUseCase = new TeacherUseCase(new TeacherServicePg());
    private districtUseCase = new DistrictUseCase(new DistrictServicePg());

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

            const isOwner = ownEntityIdFor(entityType, req.user) === String(entityId);
            if (!isAdminLike(req.user?.role) && !isOwner) {
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

            // «Düzəliş et»: admin göndərilən dəyərləri özü düzəldib təsdiqləyə bilər — body-də
            // payload gələrsə, əsl tətbiq olunan dəyər odur, pending.payload deyil.
            const finalPayload = req.body?.payload ?? pending.payload;
            const adminUserId = parseInt(req.user!.userId, 10);

            if (pending.entityType === "school") {
                await this.schoolUseCase.updateSchoolProfile(String(pending.entityId), finalPayload, adminUserId);
            } else if (pending.entityType === "teacher") {
                await this.teacherUseCase.updateTeacherProfile(String(pending.entityId), finalPayload, adminUserId);
            } else {
                await this.districtUseCase.updateDistrictProfile(String(pending.entityId), finalPayload);
            }

            const updated = await profileChangeRequestServicePg.markReviewed(id, "approved", adminUserId, null, finalPayload);
            res.json(ResponseHandler.updated(updated, "Məlumatlar təsdiqləndi"));
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

            const updated = await profileChangeRequestServicePg.markReviewed(id, "rejected", adminUserId, reviewNote);
            if (!updated) {
                res.status(404).json(ResponseHandler.notFound("Təsdiq gözləyən məlumat tapılmadı (artıq baxılıb?)"));
                return;
            }

            res.json(ResponseHandler.updated(updated, "Məlumatlar rədd edildi"));
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
