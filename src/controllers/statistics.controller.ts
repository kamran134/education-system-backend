import { Request, Response } from 'express';
import { StatisticsService } from '../services/statistics.service';
import { StatisticsFilter } from '../types/statistics.types';
import { ResponseHandler } from '../utils/response-handler.util';

export class StatisticsController {
    private statisticsService: StatisticsService;

    constructor() {
        this.statisticsService = new StatisticsService();
    }

    /**
     * Получить годовую статистику
     * GET /api/statistics/yearly
     */
    async getYearlyStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters: StatisticsFilter = {
                districtIds: req.query.districtIds 
                    ? (req.query.districtIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                schoolIds: req.query.schoolIds
                    ? (req.query.schoolIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                grades: req.query.grades
                    ? (req.query.grades as string).split(',').map(Number).filter(g => !isNaN(g))
                    : undefined,
                year: req.query.year ? parseInt(req.query.year as string) : undefined
            };

            const statistics = await this.statisticsService.getYearlyStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getYearlyStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching yearly statistics', error));
        }
    }

    /**
     * Получить помесячную статистику
     * GET /api/statistics/monthly
     */
    async getMonthlyStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters: StatisticsFilter = {
                districtIds: req.query.districtIds 
                    ? (req.query.districtIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                schoolIds: req.query.schoolIds
                    ? (req.query.schoolIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                grades: req.query.grades
                    ? (req.query.grades as string).split(',').map(Number).filter(g => !isNaN(g))
                    : undefined,
                year: req.query.year ? parseInt(req.query.year as string) : undefined
            };

            const statistics = await this.statisticsService.getMonthlyStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getMonthlyStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching monthly statistics', error));
        }
    }

    /**
     * Получить полную статистику (годовая + помесячная)
     * GET /api/statistics
     */
    async getStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters: StatisticsFilter = {
                districtIds: req.query.districtIds 
                    ? (req.query.districtIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                schoolIds: req.query.schoolIds
                    ? (req.query.schoolIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                grades: req.query.grades
                    ? (req.query.grades as string).split(',').map(Number).filter(g => !isNaN(g))
                    : undefined,
                year: req.query.year ? parseInt(req.query.year as string) : undefined
            };

            const statistics = await this.statisticsService.getStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching statistics', error));
        }
    }
}
