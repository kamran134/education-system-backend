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
exports.deleteResults = exports.createAllResults = exports.deleteStudentResult = exports.updateStudentResult = exports.createStudentResult = exports.getStudentResultById = exports.getStudentResults = exports.StudentResultController = void 0;
const studentResult_usecase_1 = require("../usecases/studentResult.usecase");
const studentResult_service_1 = require("../services/studentResult.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class StudentResultController {
    constructor() {
        this.getStudentResults = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'createdAt', 'desc');
                const result = yield this.studentResultUseCase.getStudentResults(pagination, filters, sort);
                res.json(response_handler_util_1.ResponseHandler.success({
                    data: result.data,
                    totalCount: result.totalCount
                }, 'Student results retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getStudentResultById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const result = yield this.studentResultUseCase.getStudentResultById(id);
                if (!result) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound('Student result not found'));
                    return;
                }
                res.json(response_handler_util_1.ResponseHandler.success(result, 'Student result retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.createStudentResult = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield this.studentResultUseCase.createStudentResult(req.body);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(result, 'Student result created successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.updateStudentResult = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const result = yield this.studentResultUseCase.updateStudentResult(id, req.body);
                res.json(response_handler_util_1.ResponseHandler.updated(result, 'Student result updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteStudentResult = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.studentResultUseCase.deleteStudentResult(id);
                res.json(response_handler_util_1.ResponseHandler.deleted('Student result deleted successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.processStudentResultsFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest("Fayl yüklənməyib!"));
                    return;
                }
                const { examId } = req.body;
                if (!examId) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest("İmtahan seçilməyib!"));
                    return;
                }
                const result = yield this.studentResultUseCase.processStudentResultsFromExcel(req.file.path, examId);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(result, "Şagirdlərin nəticələri uğurla yaradıldı!"));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteResultsByExamId = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { examId } = req.params;
                if (!examId) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest("İmtahan seçilməyib!"));
                    return;
                }
                const result = yield this.studentResultUseCase.deleteResultsByExamId(examId);
                if (result.deletedCount === 0) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound("Bu imtahan üçün nəticələr tapılmadı!"));
                    return;
                }
                res.json(response_handler_util_1.ResponseHandler.success({ deletedCount: result.deletedCount }, "İmtahan nəticələri uğurla silindi!"));
            }
            catch (error) {
                next(error);
            }
        });
        this.studentResultUseCase = new studentResult_usecase_1.StudentResultUseCase(new studentResult_service_1.StudentResultService());
    }
}
exports.StudentResultController = StudentResultController;
const studentResultController = new StudentResultController();
exports.getStudentResults = studentResultController.getStudentResults;
exports.getStudentResultById = studentResultController.getStudentResultById;
exports.createStudentResult = studentResultController.createStudentResult;
exports.updateStudentResult = studentResultController.updateStudentResult;
exports.deleteStudentResult = studentResultController.deleteStudentResult;
exports.createAllResults = studentResultController.processStudentResultsFromExcel;
exports.deleteResults = studentResultController.deleteResultsByExamId;
