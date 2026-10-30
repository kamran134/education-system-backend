import { ExamResultsServicePg, ExamResultsFilterPg, ExamResultRow } from "../services/examResults.service.pg";

export interface ExamResultsParams {
    search?: string;
    code?: number;
    dateFrom?: string;
    dateTo?: string;
    examIds?: number[];
    districtIds?: number[];
    schoolIds?: number[];
    teacherIds?: number[];
    studentIds?: number[];
    grades?: number[];
    examTypeId?: number;
    academicYear?: number;
    sortColumn?: string;
    sortDirection?: string;
    page?: number;
    size?: number;
}

export class ExamResultsUseCase {
    private examResultsService: ExamResultsServicePg;

    constructor() {
        this.examResultsService = new ExamResultsServicePg();
    }

    async deleteExamResults(filters: ExamResultsFilterPg): Promise<number> {
        return await this.examResultsService.deleteExamResults(filters);
    }

    async getLatestExamId(filters: ExamResultsFilterPg): Promise<number | null> {
        return await this.examResultsService.getLatestExamId(filters);
    }

    async getExamResults(params: ExamResultsParams): Promise<{ data: ExamResultRow[], totalCount: number }> {

        const {
            search,
            code,
            dateFrom,
            dateTo,
            examIds,
            districtIds,
            schoolIds,
            teacherIds,
            studentIds,
            grades,
            examTypeId,
            academicYear,
            sortColumn = 'exam.date',
            sortDirection = 'desc',
            page = 1,
            size = 25
        } = params;

        const filters: ExamResultsFilterPg = {
            search,
            code,
            dateFrom,
            dateTo,
            examIds,
            districtIds,
            schoolIds,
            teacherIds,
            studentIds,
            grades,
            examTypeId,
            academicYear
        };

        return await this.examResultsService.getExamResults(
            filters,
            sortColumn,
            sortDirection,
            page,
            size
        );
    }

    async getExamResultById(id: string): Promise<ExamResultRow | null> {
        return await this.examResultsService.getExamResultById(parseInt(id, 10));
    }
}
