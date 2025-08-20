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
exports.checkExistingSchoolCodes = exports.processSchoolsFromExcel = exports.deleteSchools = exports.deleteSchool = exports.updateSchool = exports.createSchool = exports.getSchoolByCode = exports.getSchoolById = exports.getSchoolsForFilter = exports.getSchools = exports.repairSchools = exports.createAllSchools = exports.SchoolController = void 0;
const school_usecase_1 = require("../usecases/school.usecase");
const school_service_1 = require("../services/school.service");
const request_parser_util_1 = require("../utils/request-parser.util");
class SchoolController {
    constructor() {
        this.getSchools = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
                const result = yield this.schoolUseCase.getSchools(pagination, filters, sort);
                res.json({
                    success: true,
                    data: result.data,
                    totalCount: result.totalCount,
                    message: 'Schools retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchoolsForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const schools = yield this.schoolUseCase.getSchoolsForFilter(filters);
                res.json({
                    success: true,
                    data: schools,
                    message: 'Schools for filter retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getSchoolById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const school = yield this.schoolUseCase.getSchoolById(id);
                res.json({
                    success: true,
                    data: school,
                    message: 'School retrieved successfully'
                });
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
                res.json({
                    success: true,
                    data: school,
                    message: 'School retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.createSchool = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const schoolData = req.body;
                const school = yield this.schoolUseCase.createSchool(schoolData);
                res.status(201).json({
                    success: true,
                    data: school,
                    message: 'School created successfully'
                });
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
                res.json({
                    success: true,
                    data: school,
                    message: 'School updated successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteSchool = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.schoolUseCase.deleteSchool(id);
                res.json({
                    success: true,
                    message: 'School deleted successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteSchools = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { ids } = req.body;
                const result = yield this.schoolUseCase.deleteSchools(ids);
                res.json({
                    success: true,
                    data: result,
                    message: `${result.deletedCount} school(s) deleted successfully`
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.processSchoolsFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json({ success: false, message: 'No file uploaded' });
                    return;
                }
                const result = yield this.schoolUseCase.processSchoolsFromFile(req.file.path);
                res.json({
                    success: true,
                    data: result,
                    message: `Processed ${result.processedData.length} schools from Excel file`
                });
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
                res.json({
                    success: true,
                    data: existingCodes,
                    message: 'School codes checked successfully'
                });
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
        res.json({
            success: true,
            message: 'School repair functionality not yet implemented'
        });
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
