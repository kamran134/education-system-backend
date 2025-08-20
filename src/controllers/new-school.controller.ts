import { Request, Response, NextFunction } from "express";
import { SchoolUseCase } from "../usecases/school.usecase";
import { SchoolService } from "../services/school.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class SchoolController {
    private schoolUseCase: SchoolUseCase;

    constructor() {
        this.schoolUseCase = new SchoolUseCase(new SchoolService());
    }

    getSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

            const result = await this.schoolUseCase.getSchools(pagination, filters, sort);

            res.json({
                success: true,
                data: result.data,
                totalCount: result.totalCount,
                message: 'Schools retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getSchoolsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const schools = await this.schoolUseCase.getSchoolsForFilter(filters);

            res.json({
                success: true,
                data: schools,
                message: 'Schools for filter retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getSchoolById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const school = await this.schoolUseCase.getSchoolById(id);

            res.json({
                success: true,
                data: school,
                message: 'School retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    getSchoolByCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { code } = req.params;
            // Use findByCode method from service directly since it's not in use case
            const schoolService = new SchoolService();
            const school = await schoolService.findByCode(Number(code));

            res.json({
                success: true,
                data: school,
                message: 'School retrieved successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    createSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const schoolData = req.body;
            const school = await this.schoolUseCase.createSchool(schoolData);

            res.status(201).json({
                success: true,
                data: school,
                message: 'School created successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    updateSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const school = await this.schoolUseCase.updateSchool(id, updateData);

            res.json({
                success: true,
                data: school,
                message: 'School updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.schoolUseCase.deleteSchool(id);

            res.json({
                success: true,
                message: 'School deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    deleteSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.schoolUseCase.deleteSchools(ids);

            res.json({
                success: true,
                data: result,
                message: `${result.deletedCount} school(s) deleted successfully`
            });
        } catch (error) {
            next(error);
        }
    }

    processSchoolsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json({ success: false, message: 'No file uploaded' });
                return;
            }

            const result = await this.schoolUseCase.processSchoolsFromFile(req.file.path);

            res.json({
                success: true,
                data: result,
                message: `Processed ${result.processedData.length} schools from Excel file`
            });
        } catch (error) {
            next(error);
        }
    }

    checkExistingSchoolCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            // Use service directly since this is not in use case
            const schoolService = new SchoolService();
            const existingCodes = await schoolService.checkExistingSchoolCodes(codes);

            res.json({
                success: true,
                data: existingCodes,
                message: 'School codes checked successfully'
            });
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const schoolController = new SchoolController();

export const getSchools = schoolController.getSchools;
export const getSchoolsForFilter = schoolController.getSchoolsForFilter;
export const getSchoolById = schoolController.getSchoolById;
export const getSchoolByCode = schoolController.getSchoolByCode;
export const createSchool = schoolController.createSchool;
export const updateSchool = schoolController.updateSchool;
export const deleteSchool = schoolController.deleteSchool;
export const deleteSchools = schoolController.deleteSchools;
export const processSchoolsFromExcel = schoolController.processSchoolsFromExcel;
export const checkExistingSchoolCodes = schoolController.checkExistingSchoolCodes;
