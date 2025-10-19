import { IStudentResult } from "../models/studentResult.model";
import { ITeacher } from "../models/teacher.model";
import { ISchool } from "../models/school.model";
import { IDistrict } from "../models/district.model";
import { StatsService } from "../services/stats.service";
import { FilterOptions, ValidationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export interface StatisticsFilter extends FilterOptions {
    month?: string;
}

export class StatsUseCase {
    constructor(private statsService: StatsService) {}

    async updateStatistics(): Promise<void> {
        const result = await this.statsService.updateStats();
        if (result === 404) {
            throw new Error('No results found to update statistics');
        }
    }

    async getStudentStatistics(filters: StatisticsFilter): Promise<{
        studentsOfMonth: IStudentResult[];
        studentsOfMonthByRepublic: IStudentResult[];
        developingStudents: IStudentResult[];
    }> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentStatistics(filters);
    }

    async getDevelopingStudents(filters: StatisticsFilter): Promise<IStudentResult[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getDevelopingStudents(filters);
    }

    async getStudentsOfMonth(filters: StatisticsFilter): Promise<IStudentResult[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentsOfMonth(filters);
    }

    async getStudentsOfMonthByRepublic(filters: StatisticsFilter): Promise<IStudentResult[]> {
        const validation = this.validateStatisticsFilter(filters);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStudentsOfMonthByRepublic(filters);
    }

    async getStatisticsByExam(examId: string): Promise<{
        studentsOfMonth: IStudentResult[];
        studentsOfMonthByRepublic: IStudentResult[];
        developingStudents: IStudentResult[];
    }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(examId, 'Exam ID'),
            ValidationUtils.validateObjectId(examId, 'Exam ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.statsService.getStatisticsByExam(examId);
    }

    async getTeacherStatistics(filters: FilterOptions & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: ITeacher[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getTeacherStatistics(filters, sortColumn, sortDirection);
    }

    async getSchoolStatistics(filters: FilterOptions & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: ISchool[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getSchoolStatistics(filters, sortColumn, sortDirection);
    }

    async getDistrictStatistics(filters: FilterOptions & { sortColumn?: string; sortDirection?: string; page?: number; size?: number }): Promise<{
        data: IDistrict[];
        totalCount: number;
    }> {
        const sortColumn = filters.sortColumn || 'averageScore';
        const sortDirection = filters.sortDirection || 'desc';

        return await this.statsService.getDistrictStatistics(filters, sortColumn, sortDirection);
    }

    private validateStatisticsFilter(filters: StatisticsFilter): ValidationResult {
        const errors: string[] = [];

        if (!filters.month) {
            errors.push('Month is required for statistics');
        } else {
            // Validate month format (YYYY-MM)
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
