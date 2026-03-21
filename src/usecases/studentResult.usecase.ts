import { IStudentResult, IStudentResultInput } from "../models/studentResult.model";
import { StudentResultService } from "../services/studentResult.service";
import { PaginationOptions, FilterOptions, SortOptions } from "../types/common.types";
import { Types } from "mongoose";

export interface StudentResultFileProcessingResult {
    processedData: IStudentResult[];
    studentsWithoutTeacher: any[];
    incorrectStudentCodes: number[];
    studentsWithIncorrectResults: any[];
}

export class StudentResultUseCase {
    constructor(private studentResultService: StudentResultService) {}

    async getStudentResults(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IStudentResult[], totalCount: number }> {
        return await this.studentResultService.getFilteredResults(
            pagination,
            filters,
            sort
        );
    }

    async getStudentResultById(id: string): Promise<IStudentResult | null> {
        return await this.studentResultService.findById(id);
    }

    async getResultsByStudentId(studentId: Types.ObjectId): Promise<IStudentResult[]> {
        return await this.studentResultService.getResultsByStudentId(studentId);
    }

    async getResultsByExamId(examId: Types.ObjectId): Promise<IStudentResult[]> {
        return await this.studentResultService.getResultsByExamId(examId);
    }

    async createStudentResult(resultData: IStudentResultInput): Promise<IStudentResult> {
        return await this.studentResultService.create(resultData);
    }

    async updateStudentResult(id: string, resultData: Partial<IStudentResultInput>): Promise<IStudentResult> {
        return await this.studentResultService.update(id, resultData);
    }

    async deleteStudentResult(id: string): Promise<void> {
        return await this.studentResultService.delete(id);
    }

    async processStudentResultsFromExcel(filePath: string, examId: string): Promise<StudentResultFileProcessingResult> {
        try {
            return await this.studentResultService.processStudentResultsFromExcel(filePath, examId);
        } catch (error) {
            throw new Error(`Failed to process student results from Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async deleteResultsByExamId(examId: string): Promise<{ deletedCount: number }> {
        try {
            return await this.studentResultService.deleteResultsByExamId(examId);
        } catch (error) {
            throw new Error(`Failed to delete results by exam ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async importLegacyResults(filePath: string): Promise<{
        inserted: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: any[]; errorMessages: string[] };
    }> {
        try {
            return await this.studentResultService.importLegacyResultsFromJson(filePath);
        } catch (error) {
            throw new Error(`Failed to import legacy results: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}