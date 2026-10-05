import { ExamServicePg, Exam, ExamCreate } from "../services/exam.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, FileProcessingResult, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

/** Error carrying status 400 — the global errorHandler responds with `err.status || 500`. */
function badRequest(message: string): Error {
    const err: any = new Error(message);
    err.status = 400;
    return err;
}

export class ExamUseCase {
    constructor(private examService: ExamServicePg) {}

    async getExamById(id: string): Promise<Exam> {
        const validationError = ValidationUtils.validateId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const exam = await this.examService.findById(parseInt(id, 10));
        if (!exam) {
            throw new Error('Exam not found');
        }

        return exam;
    }

    async createExam(examData: ExamCreate): Promise<Exam> {
        const errors: string[] = [];
        if (typeof examData.name !== 'string' || examData.name.trim() === '') errors.push('İmtahanın adı göstərilməyib');
        if (ValidationUtils.validateRequired(examData.date, 'date')) errors.push('İmtahanın tarixi göstərilməyib');
        if (ValidationUtils.validateRequired(examData.examTypeId, 'examTypeId')) errors.push('İmtahan növü seçilməyib');
        if (errors.length > 0) throw badRequest(errors.join(', '));

        // Парсим дату как UTC midnight чтобы избежать смещения timezone.
        // Фронт присылает строку "YYYY-MM-DD".
        if (typeof examData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(examData.date as any)) {
            examData.date = new Date((examData.date as any) + 'T00:00:00.000Z') as any;
        }
        if (isNaN(new Date(examData.date).getTime())) throw badRequest('İmtahanın tarixi düzgün deyil');

        return await this.examService.create({ ...examData, name: examData.name.trim() });
    }

    async updateExam(id: string, updateData: Partial<ExamCreate>): Promise<Exam> {
        const validationError = ValidationUtils.validateId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        if (updateData.date && typeof updateData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.date as any)) {
            updateData.date = new Date((updateData.date as any) + 'T00:00:00.000Z') as any;
        }
        if (updateData.date !== undefined && isNaN(new Date(updateData.date).getTime())) {
            throw badRequest('İmtahanın tarixi düzgün deyil');
        }

        return await this.examService.update(parseInt(id, 10), updateData);
    }

    async deleteExam(id: string): Promise<void> {
        const validationError = ValidationUtils.validateId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const exam = await this.examService.findById(parseInt(id, 10));
        if (!exam) {
            throw new Error('Exam not found');
        }

        // delete() уже удаляет связанные student_results одной транзакцией — см. exam.service.pg.ts
        await this.examService.delete(parseInt(id, 10));
    }

    async deleteExams(ids: string[]): Promise<BulkOperationResult> {
        if (!ids || ids.length === 0) {
            throw new Error('Exam IDs are required');
        }

        for (const id of ids) {
            const validationError = ValidationUtils.validateId(id, 'Exam ID');
            if (validationError) {
                throw new Error(validationError);
            }
        }

        return await this.examService.deleteBulk(ids.map((id) => parseInt(id, 10)));
    }

    async getFilteredExams(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Exam[], totalCount: number }> {
        return await this.examService.getFilteredExams(pagination, filters, sort);
    }

    async getExamsForFilter(filters: FilterOptionsPg): Promise<Exam[]> {
        return await this.examService.getExamsForFilter(filters);
    }

    async getExamsByMonthYear(month: number, year: number): Promise<Exam[]> {
        ValidationUtils.validateRequired(month, 'Month');
        ValidationUtils.validateRequired(year, 'Year');

        const monthError = ValidationUtils.validateNumber(month, 'Month', 1, 12);
        if (monthError) {
            throw new Error(monthError);
        }

        const yearError = ValidationUtils.validateNumber(year, 'Year', 2000, 3000);
        if (yearError) {
            throw new Error(yearError);
        }

        return await this.examService.getExamsByMonthYear(month, year);
    }

    async processExamsFromExcel(filePath: string): Promise<FileProcessingResult<Exam>> {
        ValidationUtils.validateRequired(filePath, 'File path');

        try {
            return await this.examService.processExamsFromExcel(filePath);
        } catch (error) {
            throw new Error(`Failed to process exams from Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

}
