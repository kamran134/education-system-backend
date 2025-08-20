import { Request, Response, NextFunction } from "express";
import { DistrictUseCase } from "../usecases/district.usecase";
import { DistrictService } from "../services/district.service";
import { RequestParser } from "../utils/request-parser.util";

export class DistrictController {
    private districtUseCase: DistrictUseCase;

    constructor() {
        this.districtUseCase = new DistrictUseCase(new DistrictService());
    }

    getDistricts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            const result = await this.districtUseCase.getFilteredDistricts(pagination, filters, sort);

            res.json({
                success: true,
                data: result.data,
                totalCount: result.totalCount,
                message: 'Districts retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getDistrictsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const districts = await this.districtUseCase.getDistrictsForFilter(filters);

            res.json({
                success: true,
                data: districts,
                message: 'Districts for filter retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getDistrictById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const district = await this.districtUseCase.getDistrictById(id);

            res.json({
                success: true,
                data: district,
                message: 'District retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    createDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const districtData = req.body;
            const district = await this.districtUseCase.createDistrict(districtData);

            res.status(201).json({
                success: true,
                data: district,
                message: 'District created successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    updateDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const district = await this.districtUseCase.updateDistrict(id, updateData);

            res.json({
                success: true,
                data: district,
                message: 'District updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.districtUseCase.deleteDistrict(id);

            res.json({
                success: true,
                message: 'District deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteDistricts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.districtUseCase.deleteDistricts(ids);

            res.json({
                success: true,
                data: result,
                message: `${result.deletedCount} district(s) deleted successfully`
            });
        } catch (error) {
            next(error);
        }
    }

    processDistrictsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ success: false, message: 'No file uploaded' });
                return;
            }

            const result = await this.districtUseCase.processDistrictsFromExcel(req.file.path);

            res.json({
                success: true,
                data: result,
                message: `Processed ${result.processedData.length} districts from Excel file`
            });
        } catch (error) {
            next(error);
        }
    }

    countDistrictsRates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.districtUseCase.countDistrictsRates();

            res.json({
                success: true,
                message: 'District rates counted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    checkExistingDistrictCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const existingCodes = await this.districtUseCase.checkExistingDistrictCodes(codes);

            res.json({
                success: true,
                data: existingCodes,
                message: 'District codes checked successfully'
            });
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const districtController = new DistrictController();

export const createAllDistricts = districtController.processDistrictsFromExcel;
export const getDistricts = districtController.getDistricts;
export const getDistrictsForFilter = districtController.getDistrictsForFilter;
export const getDistrictById = districtController.getDistrictById;
export const createDistrict = districtController.createDistrict;
export const updateDistrict = districtController.updateDistrict;
export const deleteDistrict = districtController.deleteDistrict;
export const deleteDistricts = districtController.deleteDistricts;
export const processDistrictsFromExcel = districtController.processDistrictsFromExcel;
export const countDistrictsRates = districtController.countDistrictsRates;
export const checkExistingDistrictCodes = districtController.checkExistingDistrictCodes;
