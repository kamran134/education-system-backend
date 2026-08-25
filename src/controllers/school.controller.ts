import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { SchoolUseCase } from "../usecases/school.usecase";
import { SchoolServicePg } from "../services/school.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { saveEntityAvatarPg, removeEntityAvatarPg, canManageOwnEntity, isAdminLike } from "../utils/avatar.util";
import { districtIdsOfRegion } from "../utils/region-scope.util";
import { canViewEntity } from "../utils/hierarchy-access.util";
import { profileChangeRequestServicePg } from "../services/profileChangeRequest.service.pg";

export class SchoolController {
    private schoolUseCase: SchoolUseCase;

    constructor() {
        this.schoolUseCase = new SchoolUseCase(new SchoolServicePg());
    }

    updateSchoolsStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.schoolUseCase.updateSchoolsStats();
            res.json(ResponseHandler.success({}, 'Statistika uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    getSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const result = await this.schoolUseCase.getSchools(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getSchoolsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptionsPg(req);
            const schools = await this.schoolUseCase.getSchoolsForFilter(filters);

            res.json(ResponseHandler.success(schools, 'Filtr üçün məlumatlar uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getSchoolById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const school = await this.schoolUseCase.getSchoolById(id);

            const canView = await canViewEntity(req.user, 'school', school.id, { districtId: school.districtId });
            if (!canView) {
                res.status(403).json(ResponseHandler.error('Bu profilə baxmaq icazəniz yoxdur'));
                return;
            }

            res.json(ResponseHandler.success(school, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getSchoolByCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { code } = req.params;
            const schoolService = new SchoolServicePg();
            const school = await schoolService.findByCode(Number(code));

            res.json(ResponseHandler.success(school, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const schoolData = req.body;
            const school = await this.schoolUseCase.createSchool(schoolData);

            res.status(201).json(ResponseHandler.created(school, 'Məlumat uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            const changedByUserId = parseInt(req.user!.userId, 10);

            const { school, cascadedTeachersCount, cascadedStudentsCount } = await this.schoolUseCase.updateSchool(id, updateData, changedByUserId);

            res.json(ResponseHandler.updated({ ...school, cascadedTeachersCount, cascadedStudentsCount }, 'Məlumat uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    /**
     * Редактирование ПРОФИЛЯ школы — не полный updateSchool. Контроллер сам вырезает из тела
     * запроса только допустимые поля — остальные (code/active/districtId/...) молча
     * игнорируются, это и есть граница безопасности этого эндпоинта.
     *
     * BASE_FIXES_TASK.md §2.5 вернул сюда владельца (schoolDirector своей школы), но не напрямую
     * в таблицу: он попадает в очередь модерации (profile_change_requests), а не сохраняется
     * сразу. description/history — старые свободные поля (010_school_teacher_profile_text_fields.sql)
     * без собственного UI у владельца, поэтому в белый список самостоятельной заявки они не
     * входят: их по-прежнему может задать только admin-подобная роль, как и раньше.
     */
    updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const role = req.user?.role;

            if (!canManageOwnEntity(role, req.user?.schoolId, id)) {
                res.status(403).json(ResponseHandler.error('Bu məlumatları dəyişməyə icazəniz yoxdur'));
                return;
            }

            if (isAdminLike(role)) {
                const { description, history, directorName, foundedYear, achievements } = req.body;
                const changedByUserId = parseInt(req.user!.userId, 10);
                const { school } = await this.schoolUseCase.updateSchoolProfile(id, { description, history, directorName, foundedYear, achievements }, changedByUserId);
                res.json(ResponseHandler.updated(school, 'Profil uğurla yeniləndi'));
                return;
            }

            const { directorName, foundedYear, achievements } = req.body;
            const validationError = this.schoolUseCase.validateProfilePayload({ directorName, foundedYear, achievements });
            if (validationError) {
                res.status(400).json(ResponseHandler.badRequest(validationError));
                return;
            }

            const submittedBy = parseInt(req.user!.userId, 10);
            const request = await profileChangeRequestServicePg.submit('school', parseInt(id, 10), { directorName, foundedYear, achievements }, submittedBy);
            res.status(202).json(ResponseHandler.success(request, 'Məlumatlar admin təsdiqinə göndərildi'));
        } catch (error) {
            next(error);
        }
    }

    deleteSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.schoolUseCase.deleteSchool(id);

            res.json(ResponseHandler.deleted('Məlumat uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    deleteSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { schoolIds } = req.params;
            const ids = schoolIds.split(',');
            const result = await this.schoolUseCase.deleteSchools(ids);

            res.json(ResponseHandler.success(result, ` məlumat uğurla silindi`));
        } catch (error) {
            next(error);
        }
    }

    processSchoolsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.schoolUseCase.processSchoolsFromFile(req.file.path);

            res.json(ResponseHandler.success(result, `${result.processedData.length} schools fayldan uğurla emal edildi`));
        } catch (error) {
            next(error);
        } finally {
            if (req.file) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (unlinkError) {
                    console.error('Error deleting temp file:', unlinkError);
                }
            }
        }
    }

    checkExistingSchoolCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const schoolService = new SchoolServicePg();
            const existingCodes = await schoolService.checkExistingSchoolCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Kodlar uğurla yoxlanıldı'));
        } catch (error) {
            next(error);
        }
    }

    importLegacySchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.schoolUseCase.importLegacySchools(req.file.path);
            const { inserted, skipped, errors } = result;
            const total = inserted + skipped + errors;

            res.json(ResponseHandler.success(
                result,
                `${total} qeyd emal edildi: ${inserted} əlavə edildi, ${skipped} buraxıldı, ${errors} xəta`
            ));
        } catch (error) {
            next(error);
        } finally {
            if (req.file) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (unlinkError) {
                    console.error('Error deleting temp file:', unlinkError);
                }
            }
        }
    }

    uploadAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.schoolId, id)) {
                if (req.file) fs.unlinkSync(req.file.path);
                res.status(403).json(ResponseHandler.error('Yalnız öz məktəbinizin fotosunu dəyişə bilərsiniz'));
                return;
            }

            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const avatarUrl = await saveEntityAvatarPg('schools', parseInt(id, 10), req.file, '/uploads/schools/avatars');

            if (!avatarUrl) {
                res.status(404).json(ResponseHandler.notFound('Məktəb tapılmadı'));
                return;
            }

            res.json(ResponseHandler.success({ avatarUrl }, 'Avatar uğurla yükləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.schoolId, id)) {
                res.status(403).json(ResponseHandler.error('Yalnız öz məktəbinizin fotosunu dəyişə bilərsiniz'));
                return;
            }

            const found = await removeEntityAvatarPg('schools', parseInt(id, 10));

            if (!found) {
                res.status(404).json(ResponseHandler.notFound('Məktəb tapılmadı'));
                return;
            }

            res.json(ResponseHandler.deleted('Avatar uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const schoolController = new SchoolController();

export const createAllSchools = schoolController.processSchoolsFromExcel;
export const repairSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const schoolService = new SchoolServicePg();
        const result = await schoolService.repairSchoolAssignments();
        res.json(ResponseHandler.success(result, `Repaired ${result.repairedSchools.length} schools`));
    } catch (error) {
        next(error);
    }
};

export const getSchools = schoolController.getSchools;
export const getSchoolsForFilter = schoolController.getSchoolsForFilter;
export const getSchoolById = schoolController.getSchoolById;
export const getSchoolByCode = schoolController.getSchoolByCode;
export const createSchool = schoolController.createSchool;
export const updateSchool = schoolController.updateSchool;
export const updateSchoolProfile = schoolController.updateProfile;
export const deleteSchool = schoolController.deleteSchool;
export const deleteSchools = schoolController.deleteSchools;
export const processSchoolsFromExcel = schoolController.processSchoolsFromExcel;
export const checkExistingSchoolCodes = schoolController.checkExistingSchoolCodes;
export const updateSchoolsStats = schoolController.updateSchoolsStats;
export const importLegacySchools = schoolController.importLegacySchools;
export const uploadSchoolAvatar = schoolController.uploadAvatar;
export const deleteSchoolAvatar = schoolController.deleteAvatar;
