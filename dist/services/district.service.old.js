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
exports.deleteDistrictById = exports.countDistrictsRates = exports.checkExistingDistrictCodes = exports.checkExistingDistricts = exports.checkExistingDistrict = void 0;
const district_model_1 = __importDefault(require("../models/district.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const checkExistingDistrict = (district) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const foundedDistrict = yield district_model_1.default.find({ code: district.code });
        return foundedDistrict.length > 0;
    }
    catch (error) {
        console.error(error);
        return true;
    }
});
exports.checkExistingDistrict = checkExistingDistrict;
const checkExistingDistricts = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("🔍 Поиск районов по кодам...");
        const result = yield district_model_1.default.find({ code: { $in: codes } });
        return result;
    }
    catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingDistricts = checkExistingDistricts;
const checkExistingDistrictCodes = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Используем .distinct() для получения массива уникальных кодов
        const existingCodes = yield district_model_1.default.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }
    catch (error) {
        console.error("Ошибка при поиске:", error);
        throw new Error("Не удалось осуществить поиск!");
    }
});
exports.checkExistingDistrictCodes = checkExistingDistrictCodes;
const countDistrictsRates = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log("🔄 Подсчёт коэффициентов районов...");
        const studentResults = yield studentResult_model_1.default.find().populate("student exam");
        const districtCounts = new Map();
        const examDistrictIds = new Set();
        for (const result of studentResults) {
            const districtId = (_a = result.student.district) === null || _a === void 0 ? void 0 : _a.toString();
            const examId = (_b = result.exam) === null || _b === void 0 ? void 0 : _b.toString();
            // Проверяем пару район-экзамен, если такой пары нет, то добавляем в мапу +1
            if (districtId && examId) {
                const examDistrictId = `${examId}-${districtId}`;
                if (!examDistrictIds.has(examDistrictId)) {
                    examDistrictIds.add(examDistrictId);
                    districtCounts.set(districtId, (districtCounts.get(districtId) || 0) + 1);
                }
            }
        }
        const bulkUpdates = Array.from(districtCounts.entries()).map(([districtId, rate]) => ({
            updateOne: {
                filter: { _id: districtId },
                update: { rate },
            },
        }));
        if (bulkUpdates.length > 0) {
            yield district_model_1.default.bulkWrite(bulkUpdates);
        }
        console.log("✅ Коэффициенты районов подсчитаны!");
    }
    catch (error) {
        console.error(error);
        throw new Error("Не удалось подсчитать рейтинги!");
    }
});
exports.countDistrictsRates = countDistrictsRates;
const deleteDistrictById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // последовательно удаляем сначала студентов, потом учителей, потом школы, а потом уже сам район
        const students = yield student_model_1.default.find({ district: id });
        const studentIds = students.map(student => student._id);
        yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        yield student_model_1.default.deleteMany({ district: id });
        yield school_model_1.default.deleteMany({ district: id });
        yield teacher_model_1.default.deleteMany({ district: id });
        yield district_model_1.default.findByIdAndDelete(id);
    }
    catch (error) {
        throw error;
    }
});
exports.deleteDistrictById = deleteDistrictById;
