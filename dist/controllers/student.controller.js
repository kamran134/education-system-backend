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
exports.repairStudents = exports.searchStudents = exports.deleteAllStudents = exports.deleteStudents = exports.deleteStudent = exports.updateStudent = exports.createStudent = exports.getStudent = exports.getStudents = exports.StudentController = void 0;
const student_usecase_1 = require("../usecases/student.usecase");
const student_service_1 = require("../services/student.service");
const studentResult_service_1 = require("../services/studentResult.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class StudentController {
    constructor() {
        const studentService = new student_service_1.StudentService();
        const studentResultService = new studentResult_service_1.StudentResultService();
        this.studentUseCase = new student_usecase_1.StudentUseCase(studentService, studentResultService);
    }
    getStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
                const result = yield this.studentUseCase.getStudents(pagination, filters, sort);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result));
            }
            catch (error) {
                console.error('Error in getStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching students', error));
            }
        });
    }
    getStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const student = yield this.studentUseCase.getStudentById(id);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(student));
            }
            catch (error) {
                console.error('Error in getStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching student', error));
                }
            }
        });
    }
    createStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const studentData = req.body;
                const student = yield this.studentUseCase.createStudent(studentData);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(student, 'Student created successfully'));
            }
            catch (error) {
                console.error('Error in createStudent:', error);
                if (error.message.includes('already exists') || error.message.includes('required') || error.message.includes('must be')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error creating student', error));
                }
            }
        });
    }
    updateStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const student = yield this.studentUseCase.updateStudent(id, updateData);
                res.status(200).json(response_handler_util_1.ResponseHandler.updated(student, 'Student updated successfully'));
            }
            catch (error) {
                console.error('Error in updateStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('already exists') || error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error updating student', error));
                }
            }
        });
    }
    deleteStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.studentUseCase.deleteStudent(id);
                res.status(200).json(response_handler_util_1.ResponseHandler.deleted('Student deleted successfully'));
            }
            catch (error) {
                console.error('Error in deleteStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting student', error));
                }
            }
        });
    }
    deleteStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { studentIds } = req.params;
                const ids = studentIds.split(',');
                const result = yield this.studentUseCase.deleteStudents(ids);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result, 'Students deleted successfully'));
            }
            catch (error) {
                console.error('Error in deleteStudents:', error);
                if (error.message.includes('must be an array') || error.message.includes('at least')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting students', error));
                }
            }
        });
    }
    deleteAllStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // This is a dangerous operation, should be protected with special authorization
                // For now, we'll just return an error
                res.status(403).json(response_handler_util_1.ResponseHandler.error('Operation not allowed'));
            }
            catch (error) {
                console.error('Error in deleteAllStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting all students', error));
            }
        });
    }
    searchStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { searchString } = req.params;
                const students = yield this.studentUseCase.searchStudents(searchString);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(students));
            }
            catch (error) {
                console.error('Error in searchStudents:', error);
                if (error.message.includes('at least')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error searching students', error));
                }
            }
        });
    }
    repairStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield this.studentUseCase.repairStudents();
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result, 'Students repaired successfully'));
            }
            catch (error) {
                console.error('Error in repairStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error repairing students', error));
            }
        });
    }
}
exports.StudentController = StudentController;
// Create instance and export methods for backward compatibility
const studentController = new StudentController();
const getStudents = (req, res) => studentController.getStudents(req, res);
exports.getStudents = getStudents;
const getStudent = (req, res) => studentController.getStudent(req, res);
exports.getStudent = getStudent;
const createStudent = (req, res) => studentController.createStudent(req, res);
exports.createStudent = createStudent;
const updateStudent = (req, res) => studentController.updateStudent(req, res);
exports.updateStudent = updateStudent;
const deleteStudent = (req, res) => studentController.deleteStudent(req, res);
exports.deleteStudent = deleteStudent;
const deleteStudents = (req, res) => studentController.deleteStudents(req, res);
exports.deleteStudents = deleteStudents;
const deleteAllStudents = (req, res) => studentController.deleteAllStudents(req, res);
exports.deleteAllStudents = deleteAllStudents;
const searchStudents = (req, res) => studentController.searchStudents(req, res);
exports.searchStudents = searchStudents;
const repairStudents = (req, res) => studentController.repairStudents(req, res);
exports.repairStudents = repairStudents;
