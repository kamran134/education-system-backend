import * as fs from "fs";
import { ITeacher, ITeacherCreate } from "../models/teacher.model";
import { TeacherService } from "../services/teacher.service";
import { PaginationOptions, FilterOptions, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS } from "../utils/entity-codes.const";
import { Types } from "mongoose";

export class TeacherUseCase {
    constructor(private teacherService: TeacherService) {}

    async updateTeachersStats(): Promise<void> {
        await this.teacherService.updateTeachersStats();
    }

    async getTeachers(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<PaginatedResponse<ITeacher>> {
        const { data, totalCount } = await this.teacherService.getFilteredTeachers(
            pagination,
            filters,
            sort
        );

        return {
            data,
            totalCount,
            page: pagination.page,
            size: pagination.size,
            totalPages: Math.ceil(totalCount / pagination.size)
        };
    }

    async getTeacherById(id: string): Promise<ITeacher> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateObjectId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const teacher = await this.teacherService.findById(id);
        if (!teacher) {
            throw new Error('Teacher not found');
        }

        return teacher;
    }

    async createTeacher(teacherData: ITeacherCreate): Promise<ITeacher> {
        const validation = this.validateTeacherData(teacherData);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingTeacher = await this.teacherService.findByCode(teacherData.code);
        if (existingTeacher) {
            throw new Error('Teacher with this code already exists');
        }

        return await this.teacherService.create(teacherData);
    }

    async updateTeacher(id: string, updateData: Partial<ITeacherCreate>): Promise<ITeacher> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateObjectId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingTeacher = await this.teacherService.findById(id);
        if (!existingTeacher) {
            throw new Error('Teacher not found');
        }

        if (updateData.code && updateData.code !== existingTeacher.code) {
            const codeExists = await this.teacherService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('Teacher with this code already exists');
            }
        }

        return await this.teacherService.update(id, updateData);
    }

    async deleteTeacher(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateObjectId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const teacher = await this.teacherService.findById(id);
        if (!teacher) {
            throw new Error('Teacher not found');
        }

        await this.teacherService.delete(id);
    }

    async deleteTeachers(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Teacher IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const objectIds = ids.map(id => new Types.ObjectId(id));
        return await this.teacherService.deleteBulk(objectIds);
    }

    async processTeachersFromFile(filePath: string): Promise<FileProcessingResult<ITeacher>> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        return await this.teacherService.processTeachersFromExcel(filePath);
    }

    async repairTeachers(): Promise<{ 
        repairedTeachers: number[], 
        failedTeachers: Array<{ code: number, reason: string }>,
        missedDistricts: number[],
        missedSchools: number[]
    }> {
        return await this.teacherService.repairTeacherAssignments();
    }

    async getTeachersForFilter(filters: FilterOptions): Promise<ITeacher[]> {
        return await this.teacherService.getTeachersForFilter(filters);
    }

    async importLegacyTeachers(filePath: string): Promise<{
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: number[]; errorMessages: string[] };
    }> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        let rawContent: string;
        try {
            rawContent = fs.readFileSync(filePath, 'utf-8').trim();
        } catch (err: any) {
            throw new Error(`Failed to read file: ${err.message}`);
        } finally {
            try { fs.unlinkSync(filePath); } catch {}
        }

        let records: any[];
        if (rawContent.startsWith('[')) {
            records = JSON.parse(rawContent);
        } else {
            records = rawContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => JSON.parse(line));
        }

        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('File must contain a non-empty array or newline-delimited JSON records');
        }

        return await this.teacherService.importLegacyTeachers(records);
    }

    private validateTeacherData(data: ITeacherCreate): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.fullname, 'Full name'),
            ValidationUtils.validateRequired(data.code, 'Teacher code'),
            ValidationUtils.validateCode(data.code, CODE_LENGTHS.TEACHER, CODE_LENGTHS.TEACHER)
        ]);
    }
}
