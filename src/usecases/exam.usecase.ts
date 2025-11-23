import { ExamService } from "../services/exam.service";
import { StudentResultService } from "../services/studentResult.service";
import { IExam, IExamCreate } from "../models/exam.model";
import { PaginationOptions, FilterOptions, SortOptions, FileProcessingResult, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { Types } from "mongoose";

export class ExamUseCase {
    private studentResultService: StudentResultService;

    constructor(private examService: ExamService) {
        this.studentResultService = new StudentResultService();
    }

    async getExamById(id: string): Promise<IExam> {
        const validationError = ValidationUtils.validateObjectId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const exam = await this.examService.findById(id);
        if (!exam) {
            throw new Error('Exam not found');
        }

        return exam;
    }

    async getExamByCode(code: number): Promise<IExam> {
        ValidationUtils.validateRequired(code, 'Exam code');
        
        const exam = await this.examService.findByCode(code);
        if (!exam) {
            throw new Error('Exam not found');
        }

        return exam;
    }

    async createExam(examData: IExamCreate): Promise<IExam> {
        ValidationUtils.validateRequired(examData.name, 'Exam name');
        ValidationUtils.validateRequired(examData.code, 'Exam code');
        ValidationUtils.validateRequired(examData.date, 'Exam date');

        // Check if exam with same code already exists
        const existingExam = await this.examService.findByCode(examData.code);
        if (existingExam) {
            throw new Error('Exam with this code already exists');
        }

        return await this.examService.create(examData);
    }

    async updateExam(id: string, updateData: Partial<IExamCreate>): Promise<IExam> {
        const validationError = ValidationUtils.validateObjectId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        // If updating code, check for conflicts
        if (updateData.code) {
            const existingExam = await this.examService.findByCode(updateData.code);
            if (existingExam && existingExam._id && existingExam._id.toString() !== id) {
                throw new Error('Exam with this code already exists');
            }
        }

        return await this.examService.update(id, updateData);
    }

    async deleteExam(id: string): Promise<void> {
        const validationError = ValidationUtils.validateObjectId(id, 'Exam ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const exam = await this.examService.findById(id);
        if (!exam) {
            throw new Error('Exam not found');
        }

        // Delete all student results for this exam first
        const examObjectId = new Types.ObjectId(id);
        await this.studentResultService.deleteByExamId(examObjectId);

        // Then delete the exam itself
        await this.examService.delete(id);
    }

    async deleteExams(ids: string[]): Promise<BulkOperationResult> {
        if (!ids || ids.length === 0) {
            throw new Error('Exam IDs are required');
        }

        for (const id of ids) {
            const validationError = ValidationUtils.validateObjectId(id, 'Exam ID');
            if (validationError) {
                throw new Error(validationError);
            }
        }

        // Delete all student results for these exams first
        const objectIds = ids.map(id => new Types.ObjectId(id));
        for (const examObjectId of objectIds) {
            await this.studentResultService.deleteByExamId(examObjectId);
        }

        // Then delete the exams
        return await this.examService.deleteBulk(objectIds);
    }

    async getFilteredExams(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IExam[], totalCount: number }> {
        return await this.examService.getFilteredExams(pagination, filters, sort);
    }

    async getExamsForFilter(filters: FilterOptions): Promise<IExam[]> {
        return await this.examService.getExamsForFilter(filters);
    }

    async getExamsByMonthYear(month: number, year: number): Promise<IExam[]> {
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

    async processExamsFromExcel(filePath: string): Promise<FileProcessingResult<IExam>> {
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
