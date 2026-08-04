import { ExamServicePg, Exam, ExamCreate } from "../services/exam.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, FileProcessingResult, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

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

    async getExamByCode(code: number): Promise<Exam> {
        ValidationUtils.validateRequired(code, 'Exam code');

        const exam = await this.examService.findByCode(code);
        if (!exam) {
            throw new Error('Exam not found');
        }

        return exam;
    }

    async createExam(examData: ExamCreate): Promise<Exam> {
        ValidationUtils.validateRequired(examData.name, 'Exam name');
        ValidationUtils.validateRequired(examData.code, 'Exam code');
        ValidationUtils.validateRequired(examData.date, 'Exam date');

        // Парсим дату как UTC midnight чтобы избежать смещения timezone.
        // Фронт присылает строку "YYYY-MM-DD".
        if (typeof examData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(examData.date as any)) {
            examData.date = new Date((examData.date as any) + 'T00:00:00.000Z') as any;
        }

        const existingExam = await this.examService.findByCode(examData.code);
        if (existingExam) {
            throw new Error('Exam with this code already exists');
        }

        return await this.examService.create(examData);
    }

    async updateExam(id: string, updateData: Partial<ExamCreate>): Promise<Exam> {
        const validationError = ValidationUtils.validateId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        if (updateData.date && typeof updateData.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.date as any)) {
            updateData.date = new Date((updateData.date as any) + 'T00:00:00.000Z') as any;
        }

        if (updateData.code) {
            const existingExam = await this.examService.findByCode(updateData.code);
            if (existingExam && existingExam.id !== parseInt(id, 10)) {
                throw new Error('Exam with this code already exists');
            }
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

    async checkExistingExamCodes(codes: number[]): Promise<number[]> {
        if (!codes || codes.length === 0) {
            return [];
        }

        return await this.examService.checkExistingExamCodes(codes);
    }
}
