import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { SchoolUseCase } from "../usecases/school.usecase";
import { SchoolService } from "../services/school.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class SchoolController {
    private schoolUseCase: SchoolUseCase;

    constructor() {
        this.schoolUseCase = new SchoolUseCase(new SchoolService());
    }

    updateSchoolsStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.schoolUseCase.updateSchoolsStats();
            res.json(ResponseHandler.success({}, 'School statistics updated successfully'));
        } catch (error) {
            next(error);
        }
    }

    getSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

            // Role-based filtering
            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                // District representer sees only schools in their district
                filters.districtIds = [new Types.ObjectId(req.user.districtId!)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                // School director sees only their school
                filters.schoolIds = [new Types.ObjectId(req.user.schoolId!)];
            }

            const result = await this.schoolUseCase.getSchools(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Schools retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    getSchoolsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptions(req);
            const schools = await this.schoolUseCase.getSchoolsForFilter(filters);

            res.json(ResponseHandler.success(schools, 'Schools for filter retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    getSchoolById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const school = await this.schoolUseCase.getSchoolById(id);

            res.json(ResponseHandler.success(school, 'School retrieved successfully'));
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

            res.json(ResponseHandler.success(school, 'School retrieved successfully'));
        } catch (error) {
            next(error);
        }
    }

    createSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const schoolData = req.body;
            const school = await this.schoolUseCase.createSchool(schoolData);

            res.status(201).json(ResponseHandler.created(school, 'School created successfully'));
        } catch (error) {
            next(error);
        }
    }

    updateSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;
            
            const school = await this.schoolUseCase.updateSchool(id, updateData);

            res.json(ResponseHandler.updated(school, 'School updated successfully'));
        } catch (error) {
            next(error);
        }
    }

    deleteSchool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.schoolUseCase.deleteSchool(id);

            res.json(ResponseHandler.deleted('School deleted successfully'));
        } catch (error) {
            next(error);
        }
    }

    deleteSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { schoolIds } = req.params;
            const ids = schoolIds.split(',');
            const result = await this.schoolUseCase.deleteSchools(ids);

            res.json(ResponseHandler.success(result, `${result.deletedCount} school(s) deleted successfully`));
        } catch (error) {
            next(error);
        }
    }

    processSchoolsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('No file uploaded'));
                return;
            }

            const result = await this.schoolUseCase.processSchoolsFromFile(req.file.path);

            res.json(ResponseHandler.success(result, `Processed ${result.processedData.length} schools from Excel file`));
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

            res.json(ResponseHandler.success(existingCodes, 'School codes checked successfully'));
        } catch (error) {
            next(error);
        }
    }

    importLegacySchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('No file uploaded'));
                return;
            }

            const result = await this.schoolUseCase.importLegacySchools(req.file.path);
            const { inserted, skipped, errors } = result;
            const total = inserted + skipped + errors;

            res.json(ResponseHandler.success(
                result,
                `Processed ${total} records: ${inserted} inserted, ${skipped} skipped, ${errors} error(s)`
            ));
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const schoolController = new SchoolController();

export const createAllSchools = schoolController.processSchoolsFromExcel;
export const repairSchools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        // This would need to be implemented based on business logic
        res.json(ResponseHandler.success({}, 'School repair functionality not yet implemented'));
    } catch (error) {
        next(error);
    }
};

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
export const updateSchoolsStats = schoolController.updateSchoolsStats;
export const importLegacySchools = schoolController.importLegacySchools;
