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
exports.deleteSchoolsByIds = exports.deleteSchoolById = exports.checkExistingSchoolCodes = exports.checkExistingSchools = exports.getFiltredSchools = void 0;
const mongoose_1 = require("mongoose");
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const getFiltredSchools = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (page - 1) * size;
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const code = req.query.code ? parseInt(req.query.code) : 0;
        const filter = {};
        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        if (code) {
            const codeString = code.toString().padEnd(5, '0');
            const codeStringEnd = code.toString().padEnd(5, '9');
            filter.code = { $gte: codeString, $lte: codeStringEnd };
        }
        const [data, totalCount] = yield Promise.all([
            school_model_1.default.find(filter)
                .populate('district')
                .sort({ [sortColumn]: sortDirection === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(size),
            school_model_1.default.countDocuments(filter)
        ]);
        return { data, totalCount };
    }
    catch (error) {
        throw error;
    }
});
exports.getFiltredSchools = getFiltredSchools;
const checkExistingSchools = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield school_model_1.default.find({ code: { $in: codes } });
        return result;
    }
    catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingSchools = checkExistingSchools;
const checkExistingSchoolCodes = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Используем .distinct() для получения массива уникальных кодов
        const existingCodes = yield school_model_1.default.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }
    catch (error) {
        console.error("Ошибка при поиске:", error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingSchoolCodes = checkExistingSchoolCodes;
const deleteSchoolById = (schoolId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ school: schoolId });
        const studentIds = students.map(student => student._id);
        yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        yield student_model_1.default.deleteMany({ school: schoolId });
        yield teacher_model_1.default.deleteMany({ school: schoolId });
        const result = yield school_model_1.default.deleteOne({ _id: schoolId });
        return result;
    }
    catch (error) {
        throw error;
    }
});
exports.deleteSchoolById = deleteSchoolById;
const deleteSchoolsByIds = (schoolIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ school: { $in: schoolIds } });
        const studentIds = students.map(student => student._id);
        yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        yield student_model_1.default.deleteMany({ school: { $in: schoolIds } });
        yield teacher_model_1.default.deleteMany({ school: { $in: schoolIds } });
        const result = yield school_model_1.default.deleteMany({ _id: { $in: schoolIds } });
        return result;
    }
    catch (error) {
        throw error;
    }
});
exports.deleteSchoolsByIds = deleteSchoolsByIds;
