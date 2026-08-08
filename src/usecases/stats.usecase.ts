import { StatsServicePg, StatisticsFilterPg, StudentResultStatRow, RankedEntity } from "../services/stats.service.pg";
import { FilterOptionsPg, ValidationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export class StatsUseCase {
    constructor(private statsService: StatsServicePg) {}

    async updateStatistics(): Promise<void> {
        const result = await this.statsService.updateStats();
        if (result === 404) {
            throw new Error('Statistikanı yeniləmək üçün heç bir nəticə tapılmadı');
        }
    }

    async updateAllStatistics(): Promise<void> {
        const result = await this.statsService.updateAllStats();
        if (result === 404) {
            throw new Error('Statistikanı yeniləmək üçün heç bir nəticə tapılmadı');
        }
    }

    async getStudentStatistics(filters: StatisticsFilterPg): Promise<{
        studentsOfMonth: StudentResultStatRow[];
        studentsOfMonthByRepublic: StudentResultStatRow[];
        developingStudents: StudentResultStatRow[];
    }> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentStatistics(filters);
    }

    async getDevelopingStudents(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getDevelopingStudents(filters);
    }

    async getStudentsOfMonth(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentsOfMonth(filters);
    }

    async getStudentsOfMonthByRepublic(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentsOfMonthByRepublic(filters);
    }

    async getStatisticsByExam(examId: string): Promise<{
        studentsOfMonth: StudentResultStatRow[];
        studentsOfMonthByRepublic: StudentResultStatRow[];
        developingStudents: StudentResultStatRow[];
    }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(examId, 'Exam ID'),
            ValidationUtils.validateId(examId, 'Exam ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStatisticsByExam(parseInt(examId, 10));
    }

    async getTeacherStatistics(filters: FilterOptionsPg & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: RankedEntity[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getTeacherStatistics(filters, sortColumn, sortDirection);
    }

    async getSchoolStatistics(filters: FilterOptionsPg & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: RankedEntity[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getSchoolStatistics(filters, sortColumn, sortDirection);
    }

    async getDistrictStatistics(filters: FilterOptionsPg & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: RankedEntity[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getDistrictStatistics(filters, sortColumn, sortDirection);
    }

    async getRegionStatistics(filters: FilterOptionsPg & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: RankedEntity[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getRegionStatistics(filters, sortColumn, sortDirection);
    }

    private validateStatisticsFilter(filters: StatisticsFilterPg): ValidationResult {
        const errors: string[] = [];

        if (!filters.month) {
            errors.push('Month is required for statistics');
        } else {
            const monthPattern = /^\d{4}-\d{2}$/;
            if (!monthPattern.test(filters.month)) {
                errors.push('Month must be in format YYYY-MM');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
