import { Request, Response, NextFunction } from "express";
import { TeacherUseCase } from "../usecases/teacher.usecase";
import { TeacherService } from "../services/teacher.service";
import { RequestParser } from "../utils/request-parser.util";

export class TeacherController {
    private teacherUseCase: TeacherUseCase;

    constructor() {
        this.teacherUseCase = new TeacherUseCase(new TeacherService());
    }

    getTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            const result = await this.teacherUseCase.getTeachers(pagination, filters, sort);

            res.json({
                success: true,
                data: result.data,
                totalCount: result.totalCount,
                message: 'Teachers retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getTeachersForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const teachers = await this.teacherUseCase.getTeachersForFilter(filters);

            res.json({
                success: true,
                data: teachers,
                message: 'Teachers for filter retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getTeacherById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const teacher = await this.teacherUseCase.getTeacherById(id);

            res.json({
                success: true,
                data: teacher,
                message: 'Teacher retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    createTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const teacherData = req.body;
            const teacher = await this.teacherUseCase.createTeacher(teacherData);

            res.status(201).json({
                success: true,
                data: teacher,
                message: 'Teacher created successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    updateTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const teacher = await this.teacherUseCase.updateTeacher(id, updateData);

            res.json({
                success: true,
                data: teacher,
                message: 'Teacher updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteTeacher = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.teacherUseCase.deleteTeacher(id);

            res.json({
                success: true,
                message: 'Teacher deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.teacherUseCase.deleteTeachers(ids);

            res.json({
                success: true,
                data: result,
                message: `${result.deletedCount} teacher(s) deleted successfully`
            });
        } catch (error) {
            next(error);
        }
    }

    processTeachersFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ success: false, message: 'No file uploaded' });
                return;
            }

            const result = await this.teacherUseCase.processTeachersFromFile(req.file.path);

            res.json({
                success: true,
                data: result,
                message: `Processed ${result.processedData.length} teachers from Excel file`
            });
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

            res.json({
                success: true,
                data: existingCodes,
                message: 'Teacher codes checked successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    repairTeachers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // This would need to be implemented based on business logic
            res.json({
                success: true,
                message: 'Teacher repair functionality not yet implemented'
            });
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
