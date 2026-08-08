import { Request, Response, NextFunction } from "express";
import { ExamUseCase } from "../usecases/exam.usecase";
import { ExamServicePg } from "../services/exam.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class ExamController {
    private examUseCase: ExamUseCase;

    constructor() {
        this.examUseCase = new ExamUseCase(new ExamServicePg());
    }

    getExams = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            console.log('Exam Controller - Query params:', req.query);

            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'date', 'desc');

            console.log('Exam Controller - Parsed filters:', filters);

            const result = await this.examUseCase.getFilteredExams(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            console.error('Exam Controller - Error:', error);
            next(error);
        }
    }

    getExamsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptionsPg(req);
            const exams = await this.examUseCase.getExamsForFilter(filters);

            res.json(ResponseHandler.success(exams, 'Filtr üçün məlumatlar uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getExamById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const exam = await this.examUseCase.getExamById(id);

            res.json(ResponseHandler.success(exam, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getExamsByMonthYear = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { month, year } = req.query;
            const exams = await this.examUseCase.getExamsByMonthYear(Number(month), Number(year));

            res.json(ResponseHandler.success(exams, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const examData = req.body;
            const exam = await this.examUseCase.createExam(examData);

            res.status(201).json(ResponseHandler.created(exam, 'Məlumat uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const exam = await this.examUseCase.updateExam(id, updateData);

            res.json(ResponseHandler.updated(exam, 'Məlumat uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.examUseCase.deleteExam(id);

            res.json(ResponseHandler.deleted('Məlumat uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    deleteExams = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.examUseCase.deleteExams(ids);

            res.json(ResponseHandler.success(result, ` məlumat uğurla silindi`));
        } catch (error) {
            next(error);
        }
    }

    processExamsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.examUseCase.processExamsFromExcel(req.file.path);

            res.json(ResponseHandler.success(result, `${result.processedData.length} exams fayldan uğurla emal edildi`));
        } catch (error) {
            next(error);
        }
    }

    checkExistingExamCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const existingCodes = await this.examUseCase.checkExistingExamCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Kodlar uğurla yoxlanıldı'));
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
