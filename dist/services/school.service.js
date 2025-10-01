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
exports.deleteSchoolsByIds = exports.deleteSchoolById = exports.checkExistingSchoolCodes = exports.checkExistingSchools = exports.getFiltredSchools = exports.SchoolService = void 0;
const mongoose_1 = require("mongoose");
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const request_parser_util_1 = require("../utils/request-parser.util");
const excel_service_1 = require("./excel.service");
const file_service_1 = require("./file.service");
class SchoolService {
    /**
     * Обновляет статистику по школам: studentCount, score, averageScore
     */
    updateSchoolsStats() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // Получаем всех студентов с school и score
            const students = yield student_model_1.default.find({}, { school: 1, score: 1 });
            // Группируем по school
            const statsMap = new Map();
            for (const student of students) {
                const schoolId = (_a = student.school) === null || _a === void 0 ? void 0 : _a.toString();
                if (!schoolId)
                    continue;
                const score = typeof student.score === 'number' ? student.score : 0;
                if (!statsMap.has(schoolId)) {
                    statsMap.set(schoolId, { sum: 0, count: 0 });
                }
                const stat = statsMap.get(schoolId);
                stat.sum += score;
                stat.count += 1;
            }
            // Обновляем каждую школу
            for (const [schoolId, { sum, count }] of statsMap.entries()) {
                const average = count > 0 ? sum / count : 0;
                yield school_model_1.default.findByIdAndUpdate(schoolId, {
                    studentCount: count,
                    score: sum,
                    averageScore: average
                });
            }
        });
    }
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield school_model_1.default.findById(id).populate('district');
        });
    }
    findByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield school_model_1.default.findOne({ code });
        });
    }
    create(schoolData) {
        return __awaiter(this, void 0, void 0, function* () {
            const school = new school_model_1.default(schoolData);
            return yield school.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedSchool = yield school_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate('district');
            if (!updatedSchool) {
                throw new Error('School not found');
            }
            return updatedSchool;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            // Delete associated teachers and students first
            const teachers = yield teacher_model_1.default.find({ school: id });
            const students = yield student_model_1.default.find({ school: id });
            if (teachers.length > 0) {
                yield teacher_model_1.default.deleteMany({ school: id });
            }
            if (students.length > 0) {
                const studentIds = students.map(s => s._id);
                yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
                yield student_model_1.default.deleteMany({ school: id });
            }
            const result = yield school_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('School not found');
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
    getFilteredSchools(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                school_model_1.default.find(filter)
                    .populate('district')
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                school_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    getSchoolsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            return yield school_model_1.default.find(filter)
                .sort({ name: 1 });
        });
    }
    processSchoolsFromExcel(filePath) {
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
                    districtCode: Number(row[1]) || 0,
                    code: Number(row[2]),
                    name: String(row[3]),
                    address: String(row[4]) || ''
                }));
                // Filter correct schools
                const correctSchoolsToInsert = dataToInsert.filter(data => data.code > 9999);
                const incorrectSchoolCodes = dataToInsert
                    .filter(data => data.code <= 9999)
                    .map(data => data.code);
                // Check existing schools
                const existingSchoolCodes = yield this.checkExistingSchoolCodes(correctSchoolsToInsert.map(data => data.code));
                const newSchools = existingSchoolCodes.length > 0
                    ? correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code))
                    : correctSchoolsToInsert;
                // Validate districts
                const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
                const existingDistricts = yield district_model_1.default.find({ code: { $in: districtCodes } });
                const districtMap = new Map(existingDistricts.map(d => [d.code, d]));
                // Create schools
                const schoolsToCreate = newSchools.map(schoolData => {
                    const district = districtMap.get(schoolData.districtCode);
                    return {
                        code: schoolData.code,
                        name: schoolData.name,
                        address: schoolData.address,
                        districtCode: schoolData.districtCode,
                        district: district === null || district === void 0 ? void 0 : district._id,
                        active: true
                    };
                });
                const createdSchools = yield school_model_1.default.insertMany(schoolsToCreate);
                processedData.push(...createdSchools.map(s => s.toObject()));
                // Clean up
                (0, file_service_1.deleteFile)(filePath);
                return {
                    processedData,
                    errors: incorrectSchoolCodes.map(code => `Invalid school code: ${code}`),
                    skippedItems: existingSchoolCodes.map(code => ({ code, reason: 'Already exists' }))
                };
            }
            catch (error) {
                (0, file_service_1.deleteFile)(filePath);
                throw error;
            }
        });
    }
    checkExistingSchoolCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            const existingCodes = yield school_model_1.default.distinct("code", { code: { $in: codes } });
            return existingCodes;
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 5);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        if (filters.active !== undefined) {
            filter.active = filters.active;
        }
        return filter;
    }
}
exports.SchoolService = SchoolService;
// Legacy functions for backward compatibility
const schoolService = new SchoolService();
const getFiltredSchools = (req) => __awaiter(void 0, void 0, void 0, function* () {
    const pagination = request_parser_util_1.RequestParser.parsePagination(req);
    const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
    const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
    return yield schoolService.getFilteredSchools(pagination, filters, sort);
});
exports.getFiltredSchools = getFiltredSchools;
const checkExistingSchools = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield school_model_1.default.find({ code: { $in: codes } });
        return result;
    }
    catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск школ!");
    }
});
exports.checkExistingSchools = checkExistingSchools;
const checkExistingSchoolCodes = (codes) => __awaiter(void 0, void 0, void 0, function* () {
    return yield schoolService.checkExistingSchoolCodes(codes);
});
exports.checkExistingSchoolCodes = checkExistingSchoolCodes;
const deleteSchoolById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    return yield schoolService.delete(id);
});
exports.deleteSchoolById = deleteSchoolById;
const deleteSchoolsByIds = (ids) => __awaiter(void 0, void 0, void 0, function* () {
    const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
    return yield schoolService.deleteBulk(objectIds);
});
exports.deleteSchoolsByIds = deleteSchoolsByIds;
