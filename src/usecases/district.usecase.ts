import { DistrictServicePg, District, DistrictCreate } from "../services/district.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, FileProcessingResult, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export class DistrictUseCase {
    constructor(private districtService: DistrictServicePg) {}

    async updateDistrictsStats(): Promise<void> {
        await this.districtService.updateDistrictsStats();
    }

    async getDistrictById(id: string): Promise<District> {
        const validationError = ValidationUtils.validateId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const district = await this.districtService.findById(parseInt(id, 10));
        if (!district) {
            throw new Error('District not found');
        }

        return district;
    }

    async getDistrictByCode(code: number): Promise<District> {
        ValidationUtils.validateRequired(code, 'District code');

        const district = await this.districtService.findByCode(code);
        if (!district) {
            throw new Error('District not found');
        }

        return district;
    }

    async createDistrict(districtData: DistrictCreate): Promise<District> {
        const validationErrors = ValidationUtils.combine([
            ValidationUtils.validateRequired(districtData.name, 'District name'),
            ValidationUtils.validateRequired(districtData.code, 'District code'),
            ValidationUtils.validateRequired(districtData.regionId, 'Region'),
        ]);
        if (!validationErrors.isValid) {
            throw new Error(validationErrors.errors.join(', '));
        }

        const existingDistrict = await this.districtService.findByCode(districtData.code);
        if (existingDistrict) {
            throw new Error('District with this code already exists');
        }

        return await this.districtService.create(districtData);
    }

    async updateDistrict(id: string, updateData: Partial<DistrictCreate>): Promise<District> {
        const validationError = ValidationUtils.validateId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        if (updateData.code) {
            const existingDistrict = await this.districtService.findByCode(updateData.code);
            if (existingDistrict && existingDistrict.id !== parseInt(id, 10)) {
                throw new Error('District with this code already exists');
            }
        }

        // region_id is NOT NULL (006_district_region_required.sql) — reject an explicit clear
        // here instead of letting a raw Postgres constraint error surface to the client.
        if ('regionId' in updateData && !updateData.regionId) {
            throw new Error('Region is required');
        }

        return await this.districtService.update(parseInt(id, 10), updateData);
    }

    async deleteDistrict(id: string): Promise<void> {
        const validationError = ValidationUtils.validateId(id, 'District ID');
        if (validationError) {
            throw new Error(validationError);
        }

        const district = await this.districtService.findById(parseInt(id, 10));
        if (!district) {
            throw new Error('District not found');
        }

        await this.districtService.delete(parseInt(id, 10));
    }

    async deleteDistricts(ids: string[]): Promise<BulkOperationResult> {
        if (!ids || ids.length === 0) {
            throw new Error('District IDs are required');
        }

        for (const id of ids) {
            const validationError = ValidationUtils.validateId(id, 'District ID');
            if (validationError) {
                throw new Error(validationError);
            }
        }

        return await this.districtService.deleteBulk(ids.map((id) => parseInt(id, 10)));
    }

    async getFilteredDistricts(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: District[], totalCount: number }> {
        return await this.districtService.getFilteredDistricts(pagination, filters, sort);
    }

    async getDistrictsForFilter(filters: FilterOptionsPg): Promise<District[]> {
        return await this.districtService.getDistrictsForFilter(filters);
    }

    async processDistrictsFromExcel(filePath: string): Promise<FileProcessingResult<District>> {
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
