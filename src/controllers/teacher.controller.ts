import { Request, Response, NextFunction } from "express";
import { TeacherUseCase } from "../usecases/teacher.usecase";
import { TeacherService } from "../services/teacher.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class TeacherController {
    private teacherUseCase: TeacherUseCase;

    constructor() {
        this.teacherUseCase = new TeacherUseCase(new TeacherService());
    }

    updateTeachersStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.teacherUseCase.updateTeachersStats();
            res.json(ResponseHandler.success({}, 'Teacher statistics updated successfully'));
        } catch (error) {
            next(error);
        }
    }

    getTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            // Role-based filtering
            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                // District representer sees teachers from their district schools
                filters.districtIds = [req.user.districtId as any];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                // School director sees only teachers from their school
                filters.schoolIds = [req.user.schoolId as any];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                // Teacher sees only themselves
                filters.teacherIds = [req.user.teacherId as any];
            }

            const result = await this.teacherUseCase.getTeachers(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Teachers retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    getTeachersForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const teachers = await this.teacherUseCase.getTeachersForFilter(filters);

            res.json(ResponseHandler.success(teachers, 'Teachers for filter retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    getTeacherById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const teacher = await this.teacherUseCase.getTeacherById(id);

            res.json(ResponseHandler.success(teacher, 'Teacher retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    createTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const teacherData = req.body;
            const teacher = await this.teacherUseCase.createTeacher(teacherData);

            res.status(201).json(ResponseHandler.created(teacher, 'Teacher created successfully'));
        } catch (error) {
            next(error);
        }
    }

    updateTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const teacher = await this.teacherUseCase.updateTeacher(id, updateData);

            res.json(ResponseHandler.updated(teacher, 'Teacher updated successfully'));
        } catch (error) {
            next(error);
        }
    }

    deleteTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.teacherUseCase.deleteTeacher(id);

            res.json(ResponseHandler.deleted('Teacher deleted successfully'));
        } catch (error) {
            next(error);
        }
    }

    deleteTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { teacherIds } = req.params;
            const ids = teacherIds.split(',');
            const result = await this.teacherUseCase.deleteTeachers(ids);

            res.json(ResponseHandler.success(result, `${result.deletedCount} teacher(s) deleted successfully`));
        } catch (error) {
            next(error);
        }
    }

    processTeachersFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('No file uploaded'));
                return;
            }

            const result = await this.teacherUseCase.processTeachersFromFile(req.file.path);

            res.json(ResponseHandler.success(result, `Processed ${result.processedData.length} teachers from Excel file`));
        } catch (error) {
            next(error);
        }
    }

    checkExistingTeacherCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            // Use service directly since this is not in use case
            const teacherService = new TeacherService();
            const existingCodes = await teacherService.checkExistingTeacherCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Teacher codes checked successfully'));
        } catch (error) {
            next(error);
        }
    }

    repairTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.teacherUseCase.repairTeachers();
            res.json(ResponseHandler.success(result, `Successfully repaired ${result.repairedTeachers.length} teacher(s)`));
        } catch (error) {
            next(error);
        }
    }

    importLegacyTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('No file uploaded'));
                return;
            }

            const result = await this.teacherUseCase.importLegacyTeachers(req.file.path);
            const { inserted, skipped, errors } = result;
            const total = inserted + skipped + errors;

            res.json(ResponseHandler.success(
                result,
                `Processed ${total} records: ${inserted} inserted, ${skipped} skipped, ${errors} error(s)`
            ));
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
export const deleteTeacher = teacherController.deleteTeacher;
export const deleteTeachers = teacherController.deleteTeachers;
export const createAllTeachers = teacherController.processTeachersFromExcel;
export const processTeachersFromExcel = teacherController.processTeachersFromExcel;
export const checkExistingTeacherCodes = teacherController.checkExistingTeacherCodes;
export const repairTeachers = teacherController.repairTeachers;
export const updateTeachersStats = teacherController.updateTeachersStats;
export const importLegacyTeachers = teacherController.importLegacyTeachers;
