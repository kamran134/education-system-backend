import { ISchool, ISchoolInput, ISchoolCreate } from "../models/school.model";
import { SchoolService } from "../services/school.service";
import { PaginationOptions, FilterOptions, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { Types } from "mongoose";

export class SchoolUseCase {
    constructor(private schoolService: SchoolService) {}

    async getSchools(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<PaginatedResponse<ISchool>> {
        const { data, totalCount } = await this.schoolService.getFilteredSchools(
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

    async getSchoolById(id: string): Promise<ISchool> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateObjectId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const school = await this.schoolService.findById(id);
        if (!school) {
            throw new Error('School not found');
        }

        return school;
    }

    async createSchool(schoolData: ISchoolCreate): Promise<ISchool> {
        const validation = this.validateSchoolData(schoolData);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingSchool = await this.schoolService.findByCode(schoolData.code);
        if (existingSchool) {
            throw new Error('School with this code already exists');
        }

        return await this.schoolService.create(schoolData);
    }

    async updateSchool(id: string, updateData: Partial<ISchoolCreate>): Promise<ISchool> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateObjectId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingSchool = await this.schoolService.findById(id);
        if (!existingSchool) {
            throw new Error('School not found');
        }

        if (updateData.code && updateData.code !== existingSchool.code) {
            const codeExists = await this.schoolService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('School with this code already exists');
            }
        }

        return await this.schoolService.update(id, updateData);
    }

    async deleteSchool(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateObjectId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const school = await this.schoolService.findById(id);
        if (!school) {
            throw new Error('School not found');
        }

        await this.schoolService.delete(id);
    }

    async deleteSchools(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'School IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const objectIds = ids.map(id => new Types.ObjectId(id));
        return await this.schoolService.deleteBulk(objectIds);
    }

    async processSchoolsFromFile(filePath: string): Promise<FileProcessingResult<ISchool>> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        return await this.schoolService.processSchoolsFromExcel(filePath);
    }

    async getSchoolsForFilter(filters: FilterOptions): Promise<ISchool[]> {
        return await this.schoolService.getSchoolsForFilter(filters);
    }

    private validateSchoolData(data: ISchoolCreate): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.name, 'School name'),
            ValidationUtils.validateRequired(data.code, 'School code'),
            ValidationUtils.validateCode(data.code, 5, 5),
            ValidationUtils.validateRequired(data.district, 'District')
        ]);
    }
}
