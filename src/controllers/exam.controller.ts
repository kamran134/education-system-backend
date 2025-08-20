import { Request, Response, NextFunction } from "express";
import { ExamUseCase } from "../usecases/exam.usecase";
import { ExamService } from "../services/exam.service";
import { RequestParser } from "../utils/request-parser.util";

export class ExamController {
    private examUseCase: ExamUseCase;

    constructor() {
        this.examUseCase = new ExamUseCase(new ExamService());
    }

    getExams = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'date', 'desc');

            const result = await this.examUseCase.getFilteredExams(pagination, filters, sort);

            res.json({
                success: true,
                data: result.data,
                totalCount: result.totalCount,
                message: 'Exams retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getExamsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const exams = await this.examUseCase.getExamsForFilter(filters);

            res.json({
                success: true,
                data: exams,
                message: 'Exams for filter retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getExamById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const exam = await this.examUseCase.getExamById(id);

            res.json({
                success: true,
                data: exam,
                message: 'Exam retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getExamsByMonthYear = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { month, year } = req.query;
            const exams = await this.examUseCase.getExamsByMonthYear(Number(month), Number(year));

            res.json({
                success: true,
                data: exams,
                message: 'Exams retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    createExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const examData = req.body;
            const exam = await this.examUseCase.createExam(examData);

            res.status(201).json({
                success: true,
                data: exam,
                message: 'Exam created successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    updateExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const exam = await this.examUseCase.updateExam(id, updateData);

            res.json({
                success: true,
                data: exam,
                message: 'Exam updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.examUseCase.deleteExam(id);

            res.json({
                success: true,
                message: 'Exam deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteExams = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.examUseCase.deleteExams(ids);

            res.json({
                success: true,
                data: result,
                message: `${result.deletedCount} exam(s) deleted successfully`
            });
        } catch (error) {
            next(error);
        }
    }

    processExamsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ success: false, message: 'No file uploaded' });
                return;
            }

            const result = await this.examUseCase.processExamsFromExcel(req.file.path);

            res.json({
                success: true,
                data: result,
                message: `Processed ${result.processedData.length} exams from Excel file`
            });
        } catch (error) {
            next(error);
        }
    }

    checkExistingExamCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const existingCodes = await this.examUseCase.checkExistingExamCodes(codes);

            res.json({
                success: true,
                data: existingCodes,
                message: 'Exam codes checked successfully'
            });
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const examController = new ExamController();

export const deleteAllExams = examController.deleteExams;
export const getExams = examController.getExams;
export const getExamsForFilter = examController.getExamsForFilter;
export const getExamById = examController.getExamById;
export const getExamsByMonthYear = examController.getExamsByMonthYear;
export const createExam = examController.createExam;
export const updateExam = examController.updateExam;
export const deleteExam = examController.deleteExam;
export const deleteExams = examController.deleteExams;
export const processExamsFromExcel = examController.processExamsFromExcel;
export const checkExistingExamCodes = examController.checkExistingExamCodes;
