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
exports.getDistrictStatistics = exports.getSchoolStatistics = exports.getTeacherStatistics = exports.getStatisticsByExam = exports.getStudentsOfMonthByRepublic = exports.getStudentsOfMonth = exports.getDevelopingStudents = exports.getStudentsStatistics = exports.updateStatistics = exports.StatsController = void 0;
const stats_usecase_1 = require("../usecases/stats.usecase");
const stats_service_1 = require("../services/stats.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class StatsController {
    constructor() {
        const statsService = new stats_service_1.StatsService();
        this.statsUseCase = new stats_usecase_1.StatsUseCase(statsService);
    }
    updateStatistics(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.statsUseCase.updateStatistics();
                res.status(200).json(response_handler_util_1.ResponseHandler.success({}, 'Statistics updated successfully'));
            }
            catch (error) {
                console.error('Error in updateStatistics:', error);
                if (error.message.includes('No results found')) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error updating statistics', error));
                }
            }
        });
    }
    getStudentsStatistics(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { month: req.query.month, sortColumn: req.query.sortColumn, sortDirection: req.query.sortDirection });
                const statistics = yield this.statsUseCase.getStudentStatistics(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(statistics));
            }
            catch (error) {
                console.error('Error in getStudentsStatistics:', error);
                if (error.message.includes('Month is required') || error.message.includes('format')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else if (error.message.includes('No exams found')) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching student statistics', error));
                }
            }
        });
    }
    getDevelopingStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { month: req.query.month, sortColumn: req.query.sortColumn, sortDirection: req.query.sortDirection });
                const students = yield this.statsUseCase.getDevelopingStudents(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(students));
            }
            catch (error) {
                console.error('Error in getDevelopingStudents:', error);
                if (error.message.includes('Month is required') || error.message.includes('format')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else if (error.message.includes('No exams found')) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching developing students', error));
                }
            }
        });
    }
    getStudentsOfMonth(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { month: req.query.month, sortColumn: req.query.sortColumn, sortDirection: req.query.sortDirection });
                const students = yield this.statsUseCase.getStudentsOfMonth(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(students));
            }
            catch (error) {
                console.error('Error in getStudentsOfMonth:', error);
                if (error.message.includes('Month is required') || error.message.includes('format')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else if (error.message.includes('No exams found')) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching students of month', error));
                }
            }
        });
    }
    getStudentsOfMonthByRepublic(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { month: req.query.month, sortColumn: req.query.sortColumn, sortDirection: req.query.sortDirection });
                const students = yield this.statsUseCase.getStudentsOfMonthByRepublic(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(students));
            }
            catch (error) {
                console.error('Error in getStudentsOfMonthByRepublic:', error);
                if (error.message.includes('Month is required') || error.message.includes('format')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else if (error.message.includes('No exams found')) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching students of month by republic', error));
                }
            }
        });
    }
    getStatisticsByExam(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { examId } = req.params;
                const statistics = yield this.statsUseCase.getStatisticsByExam(examId);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(statistics));
            }
            catch (error) {
                console.error('Error in getStatisticsByExam:', error);
                if (error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching exam statistics', error));
                }
            }
        });
    }
    getTeacherStatistics(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { sortColumn: req.query.sortColumn || 'averageScore', sortDirection: req.query.sortDirection || 'desc', page: parseInt(req.query.page) || 1, size: parseInt(req.query.size) || 100 });
                const statistics = yield this.statsUseCase.getTeacherStatistics(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(statistics));
            }
            catch (error) {
                console.error('Error in getTeacherStatistics:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching teacher statistics', error));
            }
        });
    }
    getSchoolStatistics(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { sortColumn: req.query.sortColumn || 'averageScore', sortDirection: req.query.sortDirection || 'desc', page: parseInt(req.query.page) || 1, size: parseInt(req.query.size) || 100 });
                const statistics = yield this.statsUseCase.getSchoolStatistics(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(statistics));
            }
            catch (error) {
                console.error('Error in getSchoolStatistics:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching school statistics', error));
            }
        });
    }
    getDistrictStatistics(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = Object.assign(Object.assign({}, request_parser_util_1.RequestParser.parseFilterOptions(req)), { sortColumn: req.query.sortColumn || 'averageScore', sortDirection: req.query.sortDirection || 'desc', page: parseInt(req.query.page) || 1, size: parseInt(req.query.size) || 100 });
                const statistics = yield this.statsUseCase.getDistrictStatistics(filters);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(statistics));
            }
            catch (error) {
                console.error('Error in getDistrictStatistics:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching district statistics', error));
            }
        });
    }
}
exports.StatsController = StatsController;
// Create instance and export methods for backward compatibility
const statsController = new StatsController();
const updateStatistics = (req, res) => statsController.updateStatistics(req, res);
exports.updateStatistics = updateStatistics;
const getStudentsStatistics = (req, res) => statsController.getStudentsStatistics(req, res);
exports.getStudentsStatistics = getStudentsStatistics;
const getDevelopingStudents = (req, res) => statsController.getDevelopingStudents(req, res);
exports.getDevelopingStudents = getDevelopingStudents;
const getStudentsOfMonth = (req, res) => statsController.getStudentsOfMonth(req, res);
exports.getStudentsOfMonth = getStudentsOfMonth;
const getStudentsOfMonthByRepublic = (req, res) => statsController.getStudentsOfMonthByRepublic(req, res);
exports.getStudentsOfMonthByRepublic = getStudentsOfMonthByRepublic;
const getStatisticsByExam = (req, res) => statsController.getStatisticsByExam(req, res);
exports.getStatisticsByExam = getStatisticsByExam;
const getTeacherStatistics = (req, res) => statsController.getTeacherStatistics(req, res);
exports.getTeacherStatistics = getTeacherStatistics;
const getSchoolStatistics = (req, res) => statsController.getSchoolStatistics(req, res);
exports.getSchoolStatistics = getSchoolStatistics;
const getDistrictStatistics = (req, res) => statsController.getDistrictStatistics(req, res);
exports.getDistrictStatistics = getDistrictStatistics;
