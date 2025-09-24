import { Request, Response, NextFunction } from "express";
import { StudentResultUseCase } from "../usecases/studentResult.usecase";
import { StudentResultService } from "../services/studentResult.service";
import { RequestParser } from "../utils/request-parser.util";

export class StudentResultController {
    private studentResultUseCase: StudentResultUseCase;

    constructor() {
        this.studentResultUseCase = new StudentResultUseCase(new StudentResultService());
    }

    getStudentResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'createdAt', 'desc');

            const result = await this.studentResultUseCase.getStudentResults(pagination, filters, sort);

            res.json({
                success: true,
                data: result.data,
                totalCount: result.totalCount,
                message: 'Student results retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getStudentResultById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.studentResultUseCase.getStudentResultById(id);

            if (!result) {
                res.status(404).json({
                    success: false,
                    message: 'Student result not found'
                });
                return;
            }

            res.json({
                success: true,
                data: result,
                message: 'Student result retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    createStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.studentResultUseCase.createStudentResult(req.body);

            res.status(201).json({
                success: true,
                data: result,
                message: 'Student result created successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    updateStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.studentResultUseCase.updateStudentResult(id, req.body);

            res.json({
                success: true,
                data: result,
                message: 'Student result updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.studentResultUseCase.deleteStudentResult(id);

            res.json({
                success: true,
                message: 'Student result deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    processStudentResultsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ 
                    success: false, 
                    message: "Fayl yüklənməyib!" 
                });
                return;
            }

            const { examId } = req.body;
            if (!examId) {
                res.status(400).json({ 
                    success: false, 
                    message: "İmtahan seçilməyib!" 
                });
                return;
            }

            const result = await this.studentResultUseCase.processStudentResultsFromExcel(req.file.path, examId);

            res.status(201).json({
                success: true,
                data: result,
                message: "Şagirdlərin nəticələri uğurla yaradıldı!"
            });
        } catch (error) {
            next(error);
        }
    }

    deleteResultsByExamId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { examId } = req.params;
            if (!examId) {
                res.status(400).json({ 
                    success: false, 
                    message: "İmtahan seçilməyib!" 
                });
                return;
            }

            const result = await this.studentResultUseCase.deleteResultsByExamId(examId);

            if (result.deletedCount === 0) {
                res.status(404).json({ 
                    success: false, 
                    message: "Bu imtahan üçün nəticələr tapılmadı!" 
                });
                return;
            }

            res.json({
                success: true,
                data: { deletedCount: result.deletedCount },
                message: "İmtahan nəticələri uğurla silindi!"
            });
        } catch (error) {
            next(error);
        }
    }
}

const studentResultController = new StudentResultController();

export const getStudentResults = studentResultController.getStudentResults;
export const getStudentResultById = studentResultController.getStudentResultById;
export const createStudentResult = studentResultController.createStudentResult;
export const updateStudentResult = studentResultController.updateStudentResult;
export const deleteStudentResult = studentResultController.deleteStudentResult;
export const createAllResults = studentResultController.processStudentResultsFromExcel;
export const deleteResults = studentResultController.deleteResultsByExamId;