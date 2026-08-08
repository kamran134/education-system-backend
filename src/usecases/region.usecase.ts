import { RegionServicePg, Region, RegionCreate } from "../services/region.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export class RegionUseCase {
    constructor(private regionService: RegionServicePg) {}

    async getRegionById(id: string): Promise<Region> {
        const validationError = ValidationUtils.validateId(id, "Region ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const region = await this.regionService.findById(parseInt(id, 10));
        if (!region) {
            throw new Error("Region not found");
        }

        return region;
    }

    async getRegionByCode(code: number): Promise<Region> {
        ValidationUtils.validateRequired(code, "Region code");

        const region = await this.regionService.findByCode(code);
        if (!region) {
            throw new Error("Region not found");
        }

        return region;
    }

    async createRegion(regionData: RegionCreate): Promise<Region> {
        ValidationUtils.validateRequired(regionData.name, "Region name");
        ValidationUtils.validateRequired(regionData.code, "Region code");

        const existingRegion = await this.regionService.findByCode(regionData.code);
        if (existingRegion) {
            throw new Error("Region with this code already exists");
        }

        return await this.regionService.create(regionData);
    }

    async updateRegion(id: string, updateData: Partial<RegionCreate>): Promise<Region> {
        const validationError = ValidationUtils.validateId(id, "Region ID");
        if (validationError) {
            throw new Error(validationError);
        }

        if (updateData.code) {
            const existingRegion = await this.regionService.findByCode(updateData.code);
            if (existingRegion && existingRegion.id !== parseInt(id, 10)) {
                throw new Error("Region with this code already exists");
            }
        }

        return await this.regionService.update(parseInt(id, 10), updateData);
    }

    async deleteRegion(id: string): Promise<void> {
        const validationError = ValidationUtils.validateId(id, "Region ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const region = await this.regionService.findById(parseInt(id, 10));
        if (!region) {
            throw new Error("Region not found");
        }

        await this.regionService.delete(parseInt(id, 10));
    }

    async deleteRegions(ids: string[]): Promise<BulkOperationResult> {
        if (!ids || ids.length === 0) {
            throw new Error("Region IDs are required");
        }

        for (const id of ids) {
            const validationError = ValidationUtils.validateId(id, "Region ID");
            if (validationError) {
                throw new Error(validationError);
            }
        }

        return await this.regionService.deleteBulk(ids.map((id) => parseInt(id, 10)));
    }

    async getFilteredRegions(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Region[]; totalCount: number }> {
        return await this.regionService.getFilteredRegions(pagination, filters, sort);
    }

    async getRegionsForFilter(filters: FilterOptionsPg): Promise<Region[]> {
        return await this.regionService.getRegionsForFilter(filters);
    }

    async checkExistingRegionCodes(codes: number[]): Promise<number[]> {
        if (!codes || codes.length === 0) {
            return [];
        }

        return await this.regionService.checkExistingRegionCodes(codes);
    }
}
