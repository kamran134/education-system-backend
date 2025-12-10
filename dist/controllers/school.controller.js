"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchoolsStats = exports.checkExistingSchoolCodes = exports.processSchoolsFromExcel = exports.deleteSchools = exports.deleteSchool = exports.updateSchool = exports.createSchool = exports.getSchoolByCode = exports.getSchoolById = exports.getSchoolsForFilter = exports.getSchools = exports.repairSchools = exports.createAllSchools = exports.SchoolController = void 0;
const school_usecase_1 = require("../usecases/school.usecase");
const school_service_1 = require("../services/school.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class SchoolController {
    constructor() {
        this.updateSchoolsStats = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.schoolUseCase.updateSchoolsStats();
                res.json(response_handler_util_1.ResponseHandler.success({}, 'School statistics updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchools = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
                // Role-based filtering
                if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) === 'districtRepresenter' && req.user.districtId) {
                    // District representer sees only schools in their district
                    filters.districtIds = [req.user.districtId];
                }
                else if (((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) === 'schoolDirector' && req.user.schoolId) {
                    // School director sees only their school
                    filters.schoolIds = [req.user.schoolId];
                }
                const result = yield this.schoolUseCase.getSchools(pagination, filters, sort);
                res.json(response_handler_util_1.ResponseHandler.success({
                    data: result.data,
                    totalCount: result.totalCount
                }, 'Schools retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchoolsForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const schools = yield this.schoolUseCase.getSchoolsForFilter(filters);
                res.json(response_handler_util_1.ResponseHandler.success(schools, 'Schools for filter retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchoolById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const school = yield this.schoolUseCase.getSchoolById(id);
                res.json(response_handler_util_1.ResponseHandler.success(school, 'School retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchoolByCode = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { code } = req.params;
                // Use findByCode method from service directly since it's not in use case
                const schoolService = new school_service_1.SchoolService();
                const school = yield schoolService.findByCode(Number(code));
                res.json(response_handler_util_1.ResponseHandler.success(school, 'School retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.createSchool = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const schoolData = req.body;
                const school = yield this.schoolUseCase.createSchool(schoolData);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(school, 'School created successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.updateSchool = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const school = yield this.schoolUseCase.updateSchool(id, updateData);
                res.json(response_handler_util_1.ResponseHandler.updated(school, 'School updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteSchool = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.schoolUseCase.deleteSchool(id);
                res.json(response_handler_util_1.ResponseHandler.deleted('School deleted successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteSchools = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { schoolIds } = req.params;
                const ids = schoolIds.split(',');
                const result = yield this.schoolUseCase.deleteSchools(ids);
                res.json(response_handler_util_1.ResponseHandler.success(result, `${result.deletedCount} school(s) deleted successfully`));
            }
            catch (error) {
                next(error);
            }
        });
        this.processSchoolsFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest('No file uploaded'));
                    return;
                }
                const result = yield this.schoolUseCase.processSchoolsFromFile(req.file.path);
                res.json(response_handler_util_1.ResponseHandler.success(result, `Processed ${result.processedData.length} schools from Excel file`));
            }
            catch (error) {
                next(error);
            }
        });
        this.checkExistingSchoolCodes = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { codes } = req.body;
                // Use service directly since this is not in use case
                const schoolService = new school_service_1.SchoolService();
                const existingCodes = yield schoolService.checkExistingSchoolCodes(codes);
                res.json(response_handler_util_1.ResponseHandler.success(existingCodes, 'School codes checked successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.schoolUseCase = new school_usecase_1.SchoolUseCase(new school_service_1.SchoolService());
    }
}
exports.SchoolController = SchoolController;
// Legacy exports for backward compatibility
const schoolController = new SchoolController();
exports.createAllSchools = schoolController.processSchoolsFromExcel;
const repairSchools = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // This would need to be implemented based on business logic
        res.json(response_handler_util_1.ResponseHandler.success({}, 'School repair functionality not yet implemented'));
    }
    catch (error) {
        next(error);
    }
});
exports.repairSchools = repairSchools;
exports.getSchools = schoolController.getSchools;
exports.getSchoolsForFilter = schoolController.getSchoolsForFilter;
exports.getSchoolById = schoolController.getSchoolById;
exports.getSchoolByCode = schoolController.getSchoolByCode;
exports.createSchool = schoolController.createSchool;
exports.updateSchool = schoolController.updateSchool;
exports.deleteSchool = schoolController.deleteSchool;
exports.deleteSchools = schoolController.deleteSchools;
exports.processSchoolsFromExcel = schoolController.processSchoolsFromExcel;
exports.checkExistingSchoolCodes = schoolController.checkExistingSchoolCodes;
exports.updateSchoolsStats = schoolController.updateSchoolsStats;
