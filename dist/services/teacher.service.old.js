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
exports.deleteTeachersByIds = exports.deleteTeacherById = exports.getFiltredTeachers = exports.checkExistingTeacherCodes = exports.checkExistingTeachers = void 0;
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const mongoose_1 = require("mongoose");
const student_service_1 = require("./student.service");
const checkExistingTeachers = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_model_1.default.find({ code: { $in: codes } });
        return result;
    }
    catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingTeachers = checkExistingTeachers;
const checkExistingTeacherCodes = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Используем .distinct() для получения массива уникальных кодов
        const existingCodes = yield teacher_model_1.default.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }
    catch (error) {
        console.error("Ошибка при поиске:", error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingTeacherCodes = checkExistingTeacherCodes;
const getFiltredTeachers = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (page - 1) * size;
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const schoolIds = req.query.schoolIds
            ? req.query.schoolIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const code = req.query.code ? parseInt(req.query.code) : 0;
        const filter = {};
        if (districtIds.length > 0 && schoolIds.length == 0) {
            filter.district = { $in: districtIds };
        }
        if (schoolIds.length > 0) {
            filter.school = { $in: schoolIds };
        }
        if (code) {
            // коды учителей семизначные, поэтому мы быреём начало кода, сколько не хватает нулей, добавляем
            // Далее проверяем тех, кто больше этого значения, например: мы ввели 15, а в базе 1500000, 1500001, 1500002 и т.д.
            // мы проверяем тех, кто больше 1500000, то есть 1500001, 1500002 и т.д.
            // не в начало, а в конец добавляем нули, чтобы получить 7 значный код
            // например: 15 -> 1500000, 154 -> 1540000, 15455 -> 1545500 и т.д.
            // но! нам 16 не нужно. Или если мы ввели 15455, то нам нужно до 1545599 включительно, но не 1545600
            const codeString = code.toString().padEnd(7, '0');
            const codeStringEnd = code.toString().padEnd(7, '9');
            filter.code = { $gte: parseInt(codeString), $lte: parseInt(codeStringEnd) };
        }
        const [data, totalCount] = yield Promise.all([
            teacher_model_1.default.find(filter)
                .populate('district school')
                .sort({ [sortColumn]: sortDirection === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(size),
            teacher_model_1.default.countDocuments(filter)
        ]);
        return { data, totalCount };
    }
    catch (error) {
        throw error;
    }
});
exports.getFiltredTeachers = getFiltredTeachers;
const deleteTeacherById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [deletedStudents, deletedTeacher] = yield Promise.all([
            (0, student_service_1.deleteStudentsByTeacherId)(id),
            teacher_model_1.default.findByIdAndDelete(id)
        ]);
        return deletedTeacher;
    }
    catch (error) {
        console.error(error);
        throw new Error("Müəllim tapılmadı!");
    }
});
exports.deleteTeacherById = deleteTeacherById;
const deleteTeachersByIds = (ids) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, student_service_1.deleteStudentsByTeachersIds)(ids);
        const deletedTeachers = yield teacher_model_1.default.deleteMany({ _id: { $in: ids } });
        return deletedTeachers;
    }
    catch (error) {
        console.error(error);
        throw new Error("Müəllimlər silinə bilmədi!");
    }
});
exports.deleteTeachersByIds = deleteTeachersByIds;
