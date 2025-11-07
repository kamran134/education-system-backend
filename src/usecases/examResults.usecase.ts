import { ExamResultsService, ExamResultsFilter } from "../services/examResults.service";
import { IStudentResult } from "../models/studentResult.model";

export interface ExamResultsParams {
    search?: string;
    code?: number;
    dateFrom?: string;
    dateTo?: string;
    districtIds?: string[];
    schoolIds?: string[];
    teacherIds?: string[];
    sortColumn?: string;
    sortDirection?: string;
    page?: number;
    size?: number;
}

export class ExamResultsUseCase {
    private examResultsService: ExamResultsService;

    constructor() {
        this.examResultsService = new ExamResultsService();
    }

    async getExamResults(params: ExamResultsParams): Promise<{ data: IStudentResult[], totalCount: number }> {
        
        const {
            search,
            code,
            dateFrom,
            dateTo,
            districtIds,
            schoolIds,
            teacherIds,
            sortColumn = 'exam.date',
            sortDirection = 'desc',
            page = 1,
            size = 25
        } = params;

        const filters: ExamResultsFilter = {
            search,
            code,
            dateFrom,
            dateTo,
            districtIds,
            schoolIds,
            teacherIds
        };

        return await this.examResultsService.getExamResults(
            filters,
            sortColumn,
            sortDirection,
            page,
            size
        );
    }

    async getExamResultById(id: string): Promise<IStudentResult | null> {
        return await this.examResultsService.getExamResultById(id);
    }
}