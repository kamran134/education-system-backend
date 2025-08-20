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
exports.StatsUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
class StatsUseCase {
    constructor(statsService) {
        this.statsService = statsService;
    }
    updateStatistics() {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.statsService.updateStats();
            if (result === 404) {
                throw new Error('No results found to update statistics');
            }
        });
    }
    getStudentStatistics(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = this.validateStatisticsFilter(filters);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            return yield this.statsService.getStudentStatistics(filters);
        });
    }
    getStatisticsByExam(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(examId, 'Exam ID'),
                validation_util_1.ValidationUtils.validateObjectId(examId, 'Exam ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            return yield this.statsService.getStatisticsByExam(examId);
        });
    }
    getTeacherStatistics(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const sortColumn = filters.sortColumn || 'averageScore';
            const sortDirection = filters.sortDirection || 'desc';
            return yield this.statsService.getTeacherStatistics(filters, sortColumn, sortDirection);
        });
    }
    getSchoolStatistics(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const sortColumn = filters.sortColumn || 'averageScore';
            const sortDirection = filters.sortDirection || 'desc';
            return yield this.statsService.getSchoolStatistics(filters, sortColumn, sortDirection);
        });
    }
    getDistrictStatistics(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const sortColumn = filters.sortColumn || 'averageScore';
            const sortDirection = filters.sortDirection || 'desc';
            return yield this.statsService.getDistrictStatistics(filters, sortColumn, sortDirection);
        });
    }
    validateStatisticsFilter(filters) {
        const errors = [];
        if (!filters.month) {
            errors.push('Month is required for statistics');
        }
        else {
            // Validate month format (YYYY-MM)
            const monthPattern = /^\d{4}-\d{2}$/;
            if (!monthPattern.test(filters.month)) {
                errors.push('Month must be in format YYYY-MM');
            }
        }
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
exports.StatsUseCase = StatsUseCase;
