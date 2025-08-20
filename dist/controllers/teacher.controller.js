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
class TeacherController {
    constructor() {
        this.getTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'name', 'asc');
                const result = yield this.teacherUseCase.getTeachers(pagination, filters, sort);
                res.json({
                    success: true,
                    data: result.data,
                    totalCount: result.totalCount,
                    message: 'Teachers retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getTeachersForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const teachers = yield this.teacherUseCase.getTeachersForFilter(filters);
                res.json({
                    success: true,
                    data: teachers,
                    message: 'Teachers for filter retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getTeacherById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const teacher = yield this.teacherUseCase.getTeacherById(id);
                res.json({
                    success: true,
                    data: teacher,
                    message: 'Teacher retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.createTeacher = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const teacherData = req.body;
                const teacher = yield this.teacherUseCase.createTeacher(teacherData);
                res.status(201).json({
                    success: true,
                    data: teacher,
                    message: 'Teacher created successfully'
                });
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
                res.json({
                    success: true,
                    data: teacher,
                    message: 'Teacher updated successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteTeacher = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.teacherUseCase.deleteTeacher(id);
                res.json({
                    success: true,
                    message: 'Teacher deleted successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { ids } = req.body;
                const result = yield this.teacherUseCase.deleteTeachers(ids);
                res.json({
                    success: true,
                    data: result,
                    message: `${result.deletedCount} teacher(s) deleted successfully`
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.processTeachersFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json({ success: false, message: 'No file uploaded' });
                    return;
                }
                const result = yield this.teacherUseCase.processTeachersFromFile(req.file.path);
                res.json({
                    success: true,
                    data: result,
                    message: `Processed ${result.processedData.length} teachers from Excel file`
                });
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
                res.json({
                    success: true,
                    data: existingCodes,
                    message: 'Teacher codes checked successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.repairTeachers = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                // This would need to be implemented based on business logic
                res.json({
                    success: true,
                    message: 'Teacher repair functionality not yet implemented'
                });
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
