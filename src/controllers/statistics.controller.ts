import { Request, Response } from 'express';
import { StatisticsService } from '../services/statistics.service';
import { StatisticsFilter, InkishafFilter } from '../types/statistics.types';
import { ResponseHandler } from '../utils/response-handler.util';

/** Текущий учебный год (начало, напр. 2025 для 2025/2026) */
function getCurrentAcademicYear(): number {
    const now = new Date();
    return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Применяет RBAC: перезаписывает фильтры на основе роли JWT-пользователя */
function applyRbacFilters(req: Request, filters: StatisticsFilter): void {
    const user = req.user;
    if (!user) return;
    const adminRoles = ['admin', 'superadmin'];
    if (adminRoles.includes(user.role)) return; // admins see everything

    // Все не-админы видят только текущий учебный год
    if (!filters.year) {
        filters.year = getCurrentAcademicYear();
    }

    if (user.role === 'teacher' && user.teacherId) {
        filters.teacherIds = [user.teacherId];
        delete filters.districtIds;
        delete filters.schoolIds;
    } else if (user.role === 'schoolDirector' && user.schoolId) {
        filters.schoolIds = [user.schoolId];
        delete filters.districtIds;
        delete filters.teacherIds;
    } else if (user.role === 'districtRepresenter' && user.districtId) {
        filters.districtIds = [user.districtId];
        delete filters.schoolIds;
        delete filters.teacherIds;
    }
}

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
                year: req.query.year ? parseInt(req.query.year as string) : undefined,
                month: req.query.month as string
            };
            applyRbacFilters(req, filters);

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
                year: req.query.year ? parseInt(req.query.year as string) : undefined,
                month: req.query.month as string
            };
            applyRbacFilters(req, filters);

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
                year: req.query.year ? parseInt(req.query.year as string) : undefined,
                month: req.query.month as string
            };
            applyRbacFilters(req, filters);

            const statistics = await this.statisticsService.getStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching statistics', error));
        }
    }

    /**
     * Получить статистику inkişaf edən şagirdlər по минимуму участий
     * GET /api/statistics/inkishaf
     */
    async getInkishafStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters: InkishafFilter = {
                districtIds: req.query.districtIds
                    ? (req.query.districtIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                schoolIds: req.query.schoolIds
                    ? (req.query.schoolIds as string).split(',').filter(id => id.trim() !== '')
                    : undefined,
                grades: req.query.grades
                    ? (req.query.grades as string).split(',').map(Number).filter(g => !isNaN(g))
                    : undefined,
                year: req.query.year ? parseInt(req.query.year as string) : undefined,
                minParticipations: req.query.minParticipations
                    ? parseInt(req.query.minParticipations as string)
                    : 2
            };
            applyRbacFilters(req, filters);

            const statistics = await this.statisticsService.getInkishafStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getInkishafStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching inkishaf statistics', error));
        }
    }
}
