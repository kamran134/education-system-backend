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
exports.ExamUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
const mongoose_1 = require("mongoose");
class ExamUseCase {
    constructor(examService) {
        this.examService = examService;
    }
    getExamById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'Exam ID');
            if (validationError) {
                throw new Error(validationError);
            }
            const exam = yield this.examService.findById(id);
            if (!exam) {
                throw new Error('Exam not found');
            }
            return exam;
        });
    }
    getExamByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(code, 'Exam code');
            const exam = yield this.examService.findByCode(code);
            if (!exam) {
                throw new Error('Exam not found');
            }
            return exam;
        });
    }
    createExam(examData) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(examData.name, 'Exam name');
            validation_util_1.ValidationUtils.validateRequired(examData.code, 'Exam code');
            validation_util_1.ValidationUtils.validateRequired(examData.date, 'Exam date');
            // Check if exam with same code already exists
            const existingExam = yield this.examService.findByCode(examData.code);
            if (existingExam) {
                throw new Error('Exam with this code already exists');
            }
            return yield this.examService.create(examData);
        });
    }
    updateExam(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'Exam ID');
            if (validationError) {
                throw new Error(validationError);
            }
            // If updating code, check for conflicts
            if (updateData.code) {
                const existingExam = yield this.examService.findByCode(updateData.code);
                if (existingExam && existingExam._id && existingExam._id.toString() !== id) {
                    throw new Error('Exam with this code already exists');
                }
            }
            return yield this.examService.update(id, updateData);
        });
    }
    deleteExam(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'Exam ID');
            if (validationError) {
                throw new Error(validationError);
            }
            const exam = yield this.examService.findById(id);
            if (!exam) {
                throw new Error('Exam not found');
            }
            yield this.examService.delete(id);
        });
    }
    deleteExams(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!ids || ids.length === 0) {
                throw new Error('Exam IDs are required');
            }
            for (const id of ids) {
                const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'Exam ID');
                if (validationError) {
                    throw new Error(validationError);
                }
            }
            const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
            return yield this.examService.deleteBulk(objectIds);
        });
    }
    getFilteredExams(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.examService.getFilteredExams(pagination, filters, sort);
        });
    }
    getExamsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.examService.getExamsForFilter(filters);
        });
    }
    getExamsByMonthYear(month, year) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(month, 'Month');
            validation_util_1.ValidationUtils.validateRequired(year, 'Year');
            const monthError = validation_util_1.ValidationUtils.validateNumber(month, 'Month', 1, 12);
            if (monthError) {
                throw new Error(monthError);
            }
            const yearError = validation_util_1.ValidationUtils.validateNumber(year, 'Year', 2000, 3000);
            if (yearError) {
                throw new Error(yearError);
            }
            return yield this.examService.getExamsByMonthYear(month, year);
        });
    }
    processExamsFromExcel(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(filePath, 'File path');
            try {
                return yield this.examService.processExamsFromExcel(filePath);
            }
            catch (error) {
                throw new Error(`Failed to process exams from Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    checkExistingExamCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!codes || codes.length === 0) {
                return [];
            }
            return yield this.examService.checkExistingExamCodes(codes);
        });
    }
}
exports.ExamUseCase = ExamUseCase;
