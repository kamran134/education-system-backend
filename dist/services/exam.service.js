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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExamsByMonthYear = exports.ExamService = void 0;
const exam_model_1 = __importDefault(require("../models/exam.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const request_parser_util_1 = require("../utils/request-parser.util");
const excel_service_1 = require("./excel.service");
const file_service_1 = require("./file.service");
class ExamService {
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield exam_model_1.default.findById(id);
        });
    }
    findByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield exam_model_1.default.findOne({ code });
        });
    }
    create(examData) {
        return __awaiter(this, void 0, void 0, function* () {
            const exam = new exam_model_1.default(examData);
            return yield exam.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedExam = yield exam_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
            if (!updatedExam) {
                throw new Error('Exam not found');
            }
            return updatedExam;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            // Delete associated student results first
            yield studentResult_model_1.default.deleteMany({ exam: id });
            const result = yield exam_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('Exam not found');
            }
        });
    }
    deleteBulk(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            // Delete associated data first
            for (const id of ids) {
                yield this.delete(id.toString());
            }
            return {
                insertedCount: 0,
                modifiedCount: 0,
                deletedCount: ids.length,
                errors: []
            };
        });
    }
    getFilteredExams(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                exam_model_1.default.find(filter)
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                exam_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    getExamsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            return yield exam_model_1.default.find(filter)
                .sort({ date: -1 });
        });
    }
    getExamsByMonthYear(month, year) {
        return __awaiter(this, void 0, void 0, function* () {
            // Определяем диапазон дат для поиска экзаменов
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59, 999);
            // Получаем все экзамены за указанный месяц и год
            const exams = yield exam_model_1.default.find({
                date: { $gte: startDate, $lte: endDate }
            });
            return exams;
        });
    }
    processExamsFromExcel(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const processedData = [];
            const errors = [];
            const skippedItems = [];
            try {
                const data = (0, excel_service_1.readExcel)(filePath);
                if (!data || data.length < 4) {
                    throw new Error('Invalid Excel file format');
                }
                const rows = data.slice(3); // Skip header rows
                const dataToInsert = rows.map(row => ({
                    code: Number(row[1]),
                    name: String(row[2]),
                    date: new Date(row[3])
                })).filter(data => data.code > 0 && data.name && data.date);
                // Check existing exams
                const existingExamCodes = yield this.checkExistingExamCodes(dataToInsert.map(data => data.code));
                const newExams = existingExamCodes.length > 0
                    ? dataToInsert.filter(data => !existingExamCodes.includes(data.code))
                    : dataToInsert;
                // Create exams
                const examsToCreate = newExams.map(examData => ({
                    code: examData.code,
                    name: examData.name,
                    date: examData.date,
                    active: true
                }));
                const createdExams = yield exam_model_1.default.insertMany(examsToCreate);
                processedData.push(...createdExams.map(e => e.toObject()));
                // Clean up
                (0, file_service_1.deleteFile)(filePath);
                return {
                    processedData,
                    errors,
                    skippedItems: existingExamCodes.map(code => ({ code, reason: 'Already exists' }))
                };
            }
            catch (error) {
                (0, file_service_1.deleteFile)(filePath);
                throw error;
            }
        });
    }
    checkExistingExamCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            const existingCodes = yield exam_model_1.default.distinct("code", { code: { $in: codes } });
            return existingCodes;
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 3);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        // Поиск по названию или коду экзамена
        if (filters.search && filters.search.trim() !== '') {
            const searchTerm = filters.search.trim();
            // Если поиск содержит только цифры, ищем по коду с диапазоном
            if (/^\d+$/.test(searchTerm)) {
                const code = parseInt(searchTerm);
                const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(code, 3);
                filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
            }
            else {
                // Иначе ищем по названию
                try {
                    const searchRegex = new RegExp(searchTerm, 'i');
                    filter.name = searchRegex;
                }
                catch (regexError) {
                    console.error('Error building regex:', regexError);
                }
            }
        }
        // Фильтр по году
        if (filters.year) {
            const year = parseInt(filters.year);
            if (!isNaN(year)) {
                const startOfYear = new Date(year, 0, 1);
                const endOfYear = new Date(year + 1, 0, 1);
                filter.date = Object.assign(Object.assign({}, filter.date), { $gte: startOfYear, $lt: endOfYear });
            }
        }
        // Фильтр по месяцу (работает вместе с годом или отдельно)
        if (filters.month) {
            const month = parseInt(filters.month);
            if (!isNaN(month) && month >= 1 && month <= 12) {
                // Если год не указан, используем текущий год
                const year = filters.year ? parseInt(filters.year) : new Date().getFullYear();
                const startOfMonth = new Date(year, month - 1, 1);
                const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
                filter.date = {
                    $gte: startOfMonth,
                    $lte: endOfMonth
                };
            }
        }
        if (filters.active !== undefined) {
            filter.active = filters.active;
        }
        // Поддержка для dateFrom/dateTo (если не используются year/month фильтры)
        if (!filters.year && !filters.month && (filters.dateFrom || filters.dateTo)) {
            filter.date = {};
            if (filters.dateFrom) {
                filter.date.$gte = new Date(filters.dateFrom);
            }
            if (filters.dateTo) {
                filter.date.$lte = new Date(filters.dateTo);
            }
        }
        console.log('Exam filter built:', JSON.stringify(filter, null, 2)); // Для отладки
        return filter;
    }
}
exports.ExamService = ExamService;
// Legacy function for backward compatibility
const examService = new ExamService();
const getExamsByMonthYear = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    return yield examService.getExamsByMonthYear(month, year);
});
exports.getExamsByMonthYear = getExamsByMonthYear;
