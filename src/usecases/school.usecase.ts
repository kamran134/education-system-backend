import { ISchool, ISchoolCreate } from "../models/school.model";
import { SchoolService } from "../services/school.service";
import { PaginationOptions, FilterOptions, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { Types } from "mongoose";

export class SchoolUseCase {
    constructor(private schoolService: SchoolService) {}

    async updateSchoolsStats(): Promise<void> {
        await this.schoolService.updateSchoolsStats();
    }

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

    async createSchool(schoolData: any): Promise<ISchool> {
        // If district is an object (from frontend), extract _id and code
        if (schoolData.district && typeof schoolData.district === 'object') {
            const districtObj = schoolData.district;
            schoolData.district = districtObj._id;
            schoolData.districtCode = districtObj.code;
        }
        // If districtCode is provided but not district, find district by code
        else if (schoolData.districtCode && !schoolData.district) {
            const District = (await import('../models/district.model')).default;
            const district = await District.findOne({ code: schoolData.districtCode });
            if (!district) {
                throw new Error(`District with code ${schoolData.districtCode} not found`);
            }
            schoolData.district = district._id;
        }

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

    async updateSchool(id: string, updateData: any): Promise<ISchool> {
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

        // If district is an object (from frontend), extract _id and code
        if (updateData.district && typeof updateData.district === 'object') {
            const districtObj = updateData.district;
            updateData.district = districtObj._id;
            updateData.districtCode = districtObj.code;
        }
        // If districtCode is provided but not district, find district by code
        else if (updateData.districtCode && !updateData.district) {
            const District = (await import('../models/district.model')).default;
            const district = await District.findOne({ code: updateData.districtCode });
            if (!district) {
                throw new Error(`District with code ${updateData.districtCode} not found`);
            }
            updateData.district = district._id;
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
            ValidationUtils.validateCode(data.code, 5, 5)
        ]);
    }
}
