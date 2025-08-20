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
exports.checkExistingExamCodes = exports.processExamsFromExcel = exports.deleteExams = exports.deleteExam = exports.updateExam = exports.createExam = exports.getExamsByMonthYear = exports.getExamById = exports.getExamsForFilter = exports.getExams = exports.deleteAllExams = exports.ExamController = void 0;
const exam_usecase_1 = require("../usecases/exam.usecase");
const exam_service_1 = require("../services/exam.service");
const request_parser_util_1 = require("../utils/request-parser.util");
class ExamController {
    constructor() {
        this.getExams = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'date', 'desc');
                const result = yield this.examUseCase.getFilteredExams(pagination, filters, sort);
                res.json({
                    success: true,
                    data: result.data,
                    totalCount: result.totalCount,
                    message: 'Exams retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getExamsForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const exams = yield this.examUseCase.getExamsForFilter(filters);
                res.json({
                    success: true,
                    data: exams,
                    message: 'Exams for filter retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getExamById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const exam = yield this.examUseCase.getExamById(id);
                res.json({
                    success: true,
                    data: exam,
                    message: 'Exam retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.getExamsByMonthYear = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { month, year } = req.query;
                const exams = yield this.examUseCase.getExamsByMonthYear(Number(month), Number(year));
                res.json({
                    success: true,
                    data: exams,
                    message: 'Exams retrieved successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.createExam = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const examData = req.body;
                const exam = yield this.examUseCase.createExam(examData);
                res.status(201).json({
                    success: true,
                    data: exam,
                    message: 'Exam created successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.updateExam = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const exam = yield this.examUseCase.updateExam(id, updateData);
                res.json({
                    success: true,
                    data: exam,
                    message: 'Exam updated successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteExam = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.examUseCase.deleteExam(id);
                res.json({
                    success: true,
                    message: 'Exam deleted successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteExams = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { ids } = req.body;
                const result = yield this.examUseCase.deleteExams(ids);
                res.json({
                    success: true,
                    data: result,
                    message: `${result.deletedCount} exam(s) deleted successfully`
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.processExamsFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json({ success: false, message: 'No file uploaded' });
                    return;
                }
                const result = yield this.examUseCase.processExamsFromExcel(req.file.path);
                res.json({
                    success: true,
                    data: result,
                    message: `Processed ${result.processedData.length} exams from Excel file`
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.checkExistingExamCodes = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { codes } = req.body;
                const existingCodes = yield this.examUseCase.checkExistingExamCodes(codes);
                res.json({
                    success: true,
                    data: existingCodes,
                    message: 'Exam codes checked successfully'
                });
            }
            catch (error) {
                next(error);
            }
        });
        this.examUseCase = new exam_usecase_1.ExamUseCase(new exam_service_1.ExamService());
    }
}
exports.ExamController = ExamController;
// Legacy exports for backward compatibility
const examController = new ExamController();
exports.deleteAllExams = examController.deleteExams;
exports.getExams = examController.getExams;
exports.getExamsForFilter = examController.getExamsForFilter;
exports.getExamById = examController.getExamById;
exports.getExamsByMonthYear = examController.getExamsByMonthYear;
exports.createExam = examController.createExam;
exports.updateExam = examController.updateExam;
exports.deleteExam = examController.deleteExam;
exports.deleteExams = examController.deleteExams;
exports.processExamsFromExcel = examController.processExamsFromExcel;
exports.checkExistingExamCodes = examController.checkExistingExamCodes;
