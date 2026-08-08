import { Request, Response } from 'express';
import { StatisticsServicePg } from '../services/statistics.service.pg';
import { StatisticsFilterPg, InkishafFilterPg } from '../types/statistics.types';
import { ResponseHandler } from '../utils/response-handler.util';
import { districtIdsOfRegion } from '../utils/region-scope.util';

/** Текущий учебный год (начало, напр. 2025 для 2025/2026) */
function getCurrentAcademicYear(): number {
    const now = new Date();
    return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Применяет RBAC: перезаписывает фильтры на основе роли JWT-пользователя.
 * regionRepresenter разворачивается в districtIds своего региона — тот же паттерн,
 * что и в остальных 11 сайтах role-скоупинга (см. utils/region-scope.util.ts).
 */
async function applyRbacFilters(req: Request, filters: StatisticsFilterPg): Promise<void> {
    const user = req.user;
    if (!user) return;
    const adminRoles = ['admin', 'superadmin'];
    if (adminRoles.includes(user.role)) return; // admins see everything

    // Все не-админы видят только текущий учебный год
    if (!filters.year) {
        filters.year = getCurrentAcademicYear();
    }

    if (user.role === 'teacher' && user.teacherId) {
        filters.teacherIds = [parseInt(user.teacherId, 10)];
        delete filters.districtIds;
        delete filters.schoolIds;
        delete filters.regionIds;
    } else if (user.role === 'schoolDirector' && user.schoolId) {
        filters.schoolIds = [parseInt(user.schoolId, 10)];
        delete filters.districtIds;
        delete filters.teacherIds;
        delete filters.regionIds;
    } else if (user.role === 'districtRepresenter' && user.districtId) {
        filters.districtIds = [parseInt(user.districtId, 10)];
        delete filters.schoolIds;
        delete filters.teacherIds;
        delete filters.regionIds;
    } else if (user.role === 'regionRepresenter' && user.regionId) {
        filters.districtIds = await districtIdsOfRegion(parseInt(user.regionId, 10));
        delete filters.schoolIds;
        delete filters.teacherIds;
        delete filters.regionIds;
    }
}

function parseIdList(raw: unknown): number[] | undefined {
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return undefined;
    const ids = raw.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
    return ids.length > 0 ? ids : undefined;
}

function parseGrades(raw: unknown): number[] | undefined {
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return undefined;
    const grades = raw.split(',').map(Number).filter((g) => !isNaN(g));
    return grades.length > 0 ? grades : undefined;
}

function parseBaseFilters(req: Request): StatisticsFilterPg {
    return {
        regionIds: parseIdList(req.query.regionIds),
        districtIds: parseIdList(req.query.districtIds),
        schoolIds: parseIdList(req.query.schoolIds),
        teacherIds: parseIdList(req.query.teacherIds),
        grades: parseGrades(req.query.grades),
        year: req.query.year ? parseInt(req.query.year as string) : undefined,
        month: req.query.month as string,
    };
}

export class StatisticsController {
    private statisticsService: StatisticsServicePg;

    constructor() {
        this.statisticsService = new StatisticsServicePg();
    }

    /**
     * Получить годовую статистику
     * GET /api/statistics/yearly
     */
    async getYearlyStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = parseBaseFilters(req);
            await applyRbacFilters(req, filters);

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
            const filters = parseBaseFilters(req);
            await applyRbacFilters(req, filters);

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
            const filters = parseBaseFilters(req);
            await applyRbacFilters(req, filters);

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
            const filters: InkishafFilterPg = {
                ...parseBaseFilters(req),
                minParticipations: req.query.minParticipations ? parseInt(req.query.minParticipations as string) : 2,
            };
            await applyRbacFilters(req, filters);

            const statistics = await this.statisticsService.getInkishafStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getInkishafStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching inkishaf statistics', error));
        }
    }
}
