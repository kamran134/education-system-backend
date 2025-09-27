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
exports.repairTeachers = exports.checkExistingTeacherCodes = exports.processTeachersFromExcel = exports.createAllTeachers = exports.deleteTeachers = exports.deleteTeacher = exports.updateTeacher = exports.createTeacher = exports.getTeacherById = exports.getTeachersForFilter = exports.getTeachers = exports.TeacherController = void 0;
const teacher_usecase_1 = require("../usecases/teacher.usecase");
const teacher_service_1 = require("../services/teacher.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class TeacherController {
    constructor() {
        this.getTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'name', 'asc');
                const result = yield this.teacherUseCase.getTeachers(pagination, filters, sort);
                res.json(response_handler_util_1.ResponseHandler.success({
                    data: result.data,
                    totalCount: result.totalCount
                }, 'Teachers retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getTeachersForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const teachers = yield this.teacherUseCase.getTeachersForFilter(filters);
                res.json(response_handler_util_1.ResponseHandler.success(teachers, 'Teachers for filter retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getTeacherById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const teacher = yield this.teacherUseCase.getTeacherById(id);
                res.json(response_handler_util_1.ResponseHandler.success(teacher, 'Teacher retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.createTeacher = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const teacherData = req.body;
                const teacher = yield this.teacherUseCase.createTeacher(teacherData);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(teacher, 'Teacher created successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.updateTeacher = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const teacher = yield this.teacherUseCase.updateTeacher(id, updateData);
                res.json(response_handler_util_1.ResponseHandler.updated(teacher, 'Teacher updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteTeacher = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.teacherUseCase.deleteTeacher(id);
                res.json(response_handler_util_1.ResponseHandler.deleted('Teacher deleted successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { ids } = req.body;
                const result = yield this.teacherUseCase.deleteTeachers(ids);
                res.json(response_handler_util_1.ResponseHandler.success(result, `${result.deletedCount} teacher(s) deleted successfully`));
            }
            catch (error) {
                next(error);
            }
        });
        this.processTeachersFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest('No file uploaded'));
                    return;
                }
                const result = yield this.teacherUseCase.processTeachersFromFile(req.file.path);
                res.json(response_handler_util_1.ResponseHandler.success(result, `Processed ${result.processedData.length} teachers from Excel file`));
            }
            catch (error) {
                next(error);
            }
        });
        this.checkExistingTeacherCodes = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { codes } = req.body;
                // Use service directly since this is not in use case
                const teacherService = new teacher_service_1.TeacherService();
                const existingCodes = yield teacherService.checkExistingTeacherCodes(codes);
                res.json(response_handler_util_1.ResponseHandler.success(existingCodes, 'Teacher codes checked successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.repairTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                // This would need to be implemented based on business logic
                res.json(response_handler_util_1.ResponseHandler.success({}, 'Teacher repair functionality not yet implemented'));
            }
            catch (error) {
                next(error);
            }
        });
        this.teacherUseCase = new teacher_usecase_1.TeacherUseCase(new teacher_service_1.TeacherService());
    }
}
exports.TeacherController = TeacherController;
// Legacy exports for backward compatibility
const teacherController = new TeacherController();
exports.getTeachers = teacherController.getTeachers;
exports.getTeachersForFilter = teacherController.getTeachersForFilter;
exports.getTeacherById = teacherController.getTeacherById;
exports.createTeacher = teacherController.createTeacher;
exports.updateTeacher = teacherController.updateTeacher;
exports.deleteTeacher = teacherController.deleteTeacher;
exports.deleteTeachers = teacherController.deleteTeachers;
exports.createAllTeachers = teacherController.processTeachersFromExcel;
exports.processTeachersFromExcel = teacherController.processTeachersFromExcel;
exports.checkExistingTeacherCodes = teacherController.checkExistingTeacherCodes;
exports.repairTeachers = teacherController.repairTeachers;
