import { Request, Response, NextFunction } from "express";
import { ExamResultsUseCase } from "../usecases/examResults.usecase";
import { ExamResultsService } from "../services/examResults.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class ExamResultsController {
    private examResultsUseCase: ExamResultsUseCase;

    constructor() {
        this.examResultsUseCase = new ExamResultsUseCase();
    }

    getExamResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const sort = RequestParser.parseSorting(req, 'exam.date', 'desc');
            
            console.log('📥 Query params:', req.query);
            
            // Parse filters
            const params = {
                search: req.query.search as string,
                code: req.query.code ? parseInt(req.query.code as string) : undefined,
                dateFrom: req.query.dateFrom as string,
                dateTo: req.query.dateTo as string,
                examIds: req.query.examIds ? (req.query.examIds as string).split(',') : undefined,
                districtIds: req.query.districtIds ? (req.query.districtIds as string).split(',') : undefined,
                schoolIds: req.query.schoolIds ? (req.query.schoolIds as string).split(',') : undefined,
                teacherIds: req.query.teacherIds ? (req.query.teacherIds as string).split(',') : undefined,
                grades: req.query.grades ? (req.query.grades as string).split(',').map(g => parseInt(g)) : undefined,
                sortColumn: sort.sortColumn,
                sortDirection: sort.sortDirection as 'asc' | 'desc',
                page: pagination.page,
                size: pagination.size
            };

            console.log('🔍 Parsed params:', params);
            console.log('🎓 Grades from query:', req.query.grades);
            console.log('🎓 Parsed grades:', params.grades);

            const result = await this.examResultsUseCase.getExamResults(params);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Exam results retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    getExamResultById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.examResultsUseCase.getExamResultById(id);

            if (!result) {
                res.status(404).json(ResponseHandler.notFound('Exam result not found'));
                return;
            }

            res.json(ResponseHandler.success(result, 'Exam result retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }
}

const examResultsController = new ExamResultsController();

export const getExamResults = examResultsController.getExamResults;
export const getExamResultById = examResultsController.getExamResultById;