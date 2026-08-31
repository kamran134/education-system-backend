import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { TeacherUseCase } from "../usecases/teacher.usecase";
import { TeacherServicePg } from "../services/teacher.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { saveEntityAvatarPg, removeEntityAvatarPg, canManageOwnEntity, canManageTeacherAvatar, isAdminLike } from "../utils/avatar.util";
import { districtIdsOfRegion } from "../utils/region-scope.util";
import { canViewEntity } from "../utils/hierarchy-access.util";
import { profileChangeRequestServicePg } from "../services/profileChangeRequest.service.pg";

export class TeacherController {
    private teacherUseCase: TeacherUseCase;

    constructor() {
        this.teacherUseCase = new TeacherUseCase(new TeacherServicePg());
    }

    updateTeachersStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.teacherUseCase.updateTeachersStats();
            res.json(ResponseHandler.success({}, 'Statistika uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    getTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const result = await this.teacherUseCase.getTeachers(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getTeachersForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptionsPg(req);

            // Ролевое сужение — тот же блок, что в getTeachers выше. В *ForFilter его раньше не было:
            // districtRepresenter/schoolDirector мог перечислить всех учителей республики через /teachers/filter.
            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            // active — флаг «reytinqlərdə göstər» у учителя: скрытых видит только управляющая роль.
            if (!isAdminLike(req.user?.role)) {
                filters.active = true;
            }

            const teachers = await this.teacherUseCase.getTeachersForFilter(filters);

            res.json(ResponseHandler.success(teachers, 'Filtr üçün məlumatlar uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getTeacherById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const teacher = await this.teacherUseCase.getTeacherById(id);

            const canView = await canViewEntity(req.user, 'teacher', teacher.id, {
                schoolId: teacher.schoolId,
                districtId: teacher.districtId,
            });
            if (!canView) {
                res.status(403).json(ResponseHandler.error('Bu profilə baxmaq icazəniz yoxdur'));
                return;
            }

            res.json(ResponseHandler.success(teacher, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const teacherData = req.body;
            const teacher = await this.teacherUseCase.createTeacher(teacherData);

            res.status(201).json(ResponseHandler.created(teacher, 'Məlumat uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            const changedByUserId = parseInt(req.user!.userId, 10);

            const { teacher, cascadedStudentsCount } = await this.teacherUseCase.updateTeacher(id, updateData, changedByUserId);

            res.json(ResponseHandler.updated({ ...teacher, cascadedStudentsCount }, 'Məlumat uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    /**
     * Редактирование ПРОФИЛЯ учителя (biography, pedaqoji stajın başlanğıc ili, uğurları —
     * PROFILES_TASK.md §2.3) — не полный updateTeacher. BASE_FIXES_TASK.md §2.5 вернул сюда
     * владельца (учитель своей записи), но не напрямую в таблицу: он попадает в очередь
     * модерации (profile_change_requests). biography — старое свободное поле без своего UI у
     * владельца, в белый список самостоятельной заявки не входит, доступно только admin-подобной
     * роли, как и раньше.
     */
    updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const role = req.user?.role;

            if (!canManageOwnEntity(role, req.user?.teacherId, id)) {
                res.status(403).json(ResponseHandler.error('Bu məlumatları dəyişməyə icazəniz yoxdur'));
                return;
            }

            if (isAdminLike(role)) {
                const { biography, pedagogicalExperienceYears, achievements, gradeLabel } = req.body;
                const changedByUserId = parseInt(req.user!.userId, 10);
                const { teacher } = await this.teacherUseCase.updateTeacherProfile(id, { biography, pedagogicalExperienceYears, achievements, gradeLabel }, changedByUserId);
                res.json(ResponseHandler.updated(teacher, 'Profil uğurla yeniləndi'));
                return;
            }

            const { gradeLabel, pedagogicalExperienceYears, achievements } = req.body;
            const validationError = this.teacherUseCase.validateProfilePayload({ gradeLabel, pedagogicalExperienceYears, achievements });
            if (validationError) {
                res.status(400).json(ResponseHandler.badRequest(validationError));
                return;
            }

            const submittedBy = parseInt(req.user!.userId, 10);
            const request = await profileChangeRequestServicePg.submit('teacher', parseInt(id, 10), { gradeLabel, pedagogicalExperienceYears, achievements }, submittedBy);
            res.status(202).json(ResponseHandler.success(request, 'Məlumatlar admin təsdiqinə göndərildi'));
        } catch (error) {
            next(error);
        }
    }

    deleteTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.teacherUseCase.deleteTeacher(id);

            res.json(ResponseHandler.deleted('Məlumat uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    deleteTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { teacherIds } = req.params;
            const ids = teacherIds.split(',');
            const result = await this.teacherUseCase.deleteTeachers(ids);

            res.json(ResponseHandler.success(result, ` məlumat uğurla silindi`));
        } catch (error) {
            next(error);
        }
    }

    processTeachersFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.teacherUseCase.processTeachersFromFile(req.file.path);

            res.json(ResponseHandler.success(result, `${result.processedData.length} teachers fayldan uğurla emal edildi`));
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

    checkExistingTeacherCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const teacherService = new TeacherServicePg();
            const existingCodes = await teacherService.checkExistingTeacherCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Kodlar uğurla yoxlanıldı'));
        } catch (error) {
            next(error);
        }
    }

    repairTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.teacherUseCase.repairTeachers();
            res.json(ResponseHandler.success(result, `${result.repairedTeachers.length} müəllim uğurla bərpa edildi`));
        } catch (error) {
            next(error);
        }
    }

    importLegacyTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.teacherUseCase.importLegacyTeachers(req.file.path);
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

            if (!(await canManageTeacherAvatar(req.user, id))) {
                if (req.file) fs.unlinkSync(req.file.path);
                res.status(403).json(ResponseHandler.error('Bu fotonu dəyişməyə icazəniz yoxdur'));
                return;
            }

            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const avatarUrl = await saveEntityAvatarPg('teachers', parseInt(id, 10), req.file, '/uploads/teachers/avatars');

            if (!avatarUrl) {
                res.status(404).json(ResponseHandler.notFound('Müəllim tapılmadı'));
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

            if (!(await canManageTeacherAvatar(req.user, id))) {
                res.status(403).json(ResponseHandler.error('Bu fotonu dəyişməyə icazəniz yoxdur'));
                return;
            }

            const found = await removeEntityAvatarPg('teachers', parseInt(id, 10));

            if (!found) {
                res.status(404).json(ResponseHandler.notFound('Müəllim tapılmadı'));
                return;
            }

            res.json(ResponseHandler.deleted('Avatar uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const teacherController = new TeacherController();

export const getTeachers = teacherController.getTeachers;
export const getTeachersForFilter = teacherController.getTeachersForFilter;
export const getTeacherById = teacherController.getTeacherById;
export const createTeacher = teacherController.createTeacher;
export const updateTeacher = teacherController.updateTeacher;
export const updateTeacherProfile = teacherController.updateProfile;
export const deleteTeacher = teacherController.deleteTeacher;
export const deleteTeachers = teacherController.deleteTeachers;
export const createAllTeachers = teacherController.processTeachersFromExcel;
export const processTeachersFromExcel = teacherController.processTeachersFromExcel;
export const checkExistingTeacherCodes = teacherController.checkExistingTeacherCodes;
export const repairTeachers = teacherController.repairTeachers;
export const updateTeachersStats = teacherController.updateTeachersStats;
export const importLegacyTeachers = teacherController.importLegacyTeachers;
export const uploadTeacherAvatar = teacherController.uploadAvatar;
export const deleteTeacherAvatar = teacherController.deleteAvatar;
