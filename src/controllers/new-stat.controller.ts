import { Request, Response } from "express";
import { StatsUseCase } from "../usecases/stats.usecase";
import { StatsService } from "../services/stats.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class StatsController {
    private statsUseCase: StatsUseCase;

    constructor() {
        const statsService = new StatsService();
        this.statsUseCase = new StatsUseCase(statsService);
    }

    async updateStatistics(req: Request, res: Response): Promise<void> {
        try {
            await this.statsUseCase.updateStatistics();
            res.status(200).json(ResponseHandler.success({}, 'Statistics updated successfully'));
        } catch (error: any) {
            console.error('Error in updateStatistics:', error);
            if (error.message.includes('No results found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error updating statistics', error));
            }
        }
    }

    async getStudentsStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptions(req),
                month: req.query.month as string,
                sortColumn: req.query.sortColumn as string,
                sortDirection: req.query.sortDirection as string
            };

            const statistics = await this.statsUseCase.getStudentStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStudentsStatistics:', error);
            if (error.message.includes('Month is required') || error.message.includes('format')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else if (error.message.includes('No exams found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching student statistics', error));
            }
        }
    }

    async getStatisticsByExam(req: Request, res: Response): Promise<void> {
        try {
            const { examId } = req.params;
            const statistics = await this.statsUseCase.getStatisticsByExam(examId);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStatisticsByExam:', error);
            if (error.message.includes('ObjectId') || error.message.includes('required')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching exam statistics', error));
            }
        }
    }

    async getTeacherStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptions(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc'
            };

            const statistics = await this.statsUseCase.getTeacherStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getTeacherStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching teacher statistics', error));
        }
    }

    async getSchoolStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptions(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc'
            };

            const statistics = await this.statsUseCase.getSchoolStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getSchoolStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching school statistics', error));
        }
    }

    async getDistrictStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptions(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc'
            };

            const statistics = await this.statsUseCase.getDistrictStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getDistrictStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching district statistics', error));
        }
    }
}

// Create instance and export methods for backward compatibility
const statsController = new StatsController();

export const updateStatistics = (req: Request, res: Response) => statsController.updateStatistics(req, res);
export const getStudentsStatistics = (req: Request, res: Response) => statsController.getStudentsStatistics(req, res);
export const getStatisticsByExam = (req: Request, res: Response) => statsController.getStatisticsByExam(req, res);
export const getTeacherStatistics = (req: Request, res: Response) => statsController.getTeacherStatistics(req, res);
export const getSchoolStatistics = (req: Request, res: Response) => statsController.getSchoolStatistics(req, res);

// Add district statistics export if it doesn't exist in the original controller
export const getDistrictStatistics = (req: Request, res: Response) => statsController.getDistrictStatistics(req, res);
