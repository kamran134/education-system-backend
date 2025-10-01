import { DistrictService } from "../services/district.service";
import { IDistrict, IDistrictCreate } from "../models/district.model";
import { PaginationOptions, FilterOptions, SortOptions, FileProcessingResult, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { Types } from "mongoose";

export class DistrictUseCase {
    constructor(private districtService: DistrictService) {}

    async updateDistrictsStats(): Promise<void> {
        await this.districtService.updateDistrictsStats();
    }

    async getDistrictById(id: string): Promise<IDistrict> {
        const validationError = ValidationUtils.validateObjectId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const district = await this.districtService.findById(id);
        if (!district) {
            throw new Error('District not found');
        }

        return district;
    }

    async getDistrictByCode(code: number): Promise<IDistrict> {
        ValidationUtils.validateRequired(code, 'District code');
        
        const district = await this.districtService.findByCode(code);
        if (!district) {
            throw new Error('District not found');
        }

        return district;
    }

    async createDistrict(districtData: IDistrictCreate): Promise<IDistrict> {
        ValidationUtils.validateRequired(districtData.name, 'District name');
        ValidationUtils.validateRequired(districtData.code, 'District code');

        // Check if district with same code already exists
        const existingDistrict = await this.districtService.findByCode(districtData.code);
        if (existingDistrict) {
            throw new Error('District with this code already exists');
        }

        return await this.districtService.create(districtData);
    }

    async updateDistrict(id: string, updateData: Partial<IDistrictCreate>): Promise<IDistrict> {
        const validationError = ValidationUtils.validateObjectId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        // If updating code, check for conflicts
        if (updateData.code) {
            const existingDistrict = await this.districtService.findByCode(updateData.code);
            if (existingDistrict && existingDistrict._id && existingDistrict._id.toString() !== id) {
                throw new Error('District with this code already exists');
            }
        }

        return await this.districtService.update(id, updateData);
    }

    async deleteDistrict(id: string): Promise<void> {
        const validationError = ValidationUtils.validateObjectId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const district = await this.districtService.findById(id);
        if (!district) {
            throw new Error('District not found');
        }

        await this.districtService.delete(id);
    }

    async deleteDistricts(ids: string[]): Promise<BulkOperationResult> {
        if (!ids || ids.length === 0) {
            throw new Error('District IDs are required');
        }

        for (const id of ids) {
            const validationError = ValidationUtils.validateObjectId(id, 'District ID');
            if (validationError) {
                throw new Error(validationError);
            }
        }

        const objectIds = ids.map(id => new Types.ObjectId(id));
        return await this.districtService.deleteBulk(objectIds);
    }

    async getFilteredDistricts(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IDistrict[], totalCount: number }> {
        return await this.districtService.getFilteredDistricts(pagination, filters, sort);
    }

    async getDistrictsForFilter(filters: FilterOptions): Promise<IDistrict[]> {
        return await this.districtService.getDistrictsForFilter(filters);
    }

    async processDistrictsFromExcel(filePath: string): Promise<FileProcessingResult<IDistrict>> {
        ValidationUtils.validateRequired(filePath, 'File path');
        
        try {
            return await this.districtService.processDistrictsFromExcel(filePath);
        } catch (error) {
            throw new Error(`Failed to process districts from Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async countDistrictsRates(): Promise<void> {
        try {
            await this.districtService.countDistrictsRates();
        } catch (error) {
            throw new Error(`Failed to count district rates: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async checkExistingDistrictCodes(codes: number[]): Promise<number[]> {
        if (!codes || codes.length === 0) {
            return [];
        }

        return await this.districtService.checkExistingDistrictCodes(codes);
    }
}
