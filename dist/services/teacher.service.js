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
exports.deleteTeachersByIds = exports.deleteTeacherById = exports.getFiltredTeachers = exports.checkExistingTeacherCodes = exports.checkExistingTeachers = exports.TeacherService = void 0;
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const mongoose_1 = require("mongoose");
const student_service_1 = require("./student.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const excel_service_1 = require("./excel.service");
const file_service_1 = require("./file.service");
class TeacherService {
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield teacher_model_1.default.findById(id).populate('district school');
        });
    }
    findByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield teacher_model_1.default.findOne({ code });
        });
    }
    create(teacherData) {
        return __awaiter(this, void 0, void 0, function* () {
            const teacher = new teacher_model_1.default(teacherData);
            return yield teacher.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedTeacher = yield teacher_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate('district school');
            if (!updatedTeacher) {
                throw new Error('Teacher not found');
            }
            return updatedTeacher;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            // First delete associated students
            yield (0, student_service_1.deleteStudentsByTeacherId)(id);
            const result = yield teacher_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('Teacher not found');
            }
        });
    }
    deleteBulk(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            // First delete associated students
            yield (0, student_service_1.deleteStudentsByTeachersIds)(ids.map(id => id.toString()));
            const result = yield teacher_model_1.default.deleteMany({ _id: { $in: ids } });
            return {
                insertedCount: 0,
                modifiedCount: 0,
                deletedCount: result.deletedCount || 0,
                errors: []
            };
        });
    }
    getFilteredTeachers(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                teacher_model_1.default.find(filter)
                    .populate('district school')
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                teacher_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    getTeachersForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            return yield teacher_model_1.default.find(filter)
                .populate('school')
                .sort({ code: 1 });
        });
    }
    processTeachersFromExcel(filePath) {
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
                    schoolCode: Number(row[2]) || 0,
                    code: Number(row[3]),
                    fullname: String(row[4])
                }));
                // Filter correct teachers
                const correctTeachersToInsert = dataToInsert.filter(data => data.code > 999999);
                const incorrectTeacherCodes = dataToInsert
                    .filter(data => data.code <= 999999)
                    .map(data => data.code);
                // Check existing teachers
                const existingTeacherCodes = yield this.checkExistingTeacherCodes(correctTeachersToInsert.map(data => data.code));
                const newTeachers = existingTeacherCodes.length > 0
                    ? correctTeachersToInsert.filter(data => !existingTeacherCodes.includes(data.code))
                    : correctTeachersToInsert;
                // Validate districts and schools
                const districtCodes = newTeachers.filter(item => item.districtCode > 0).map(item => item.districtCode);
                const schoolCodes = newTeachers.filter(item => item.schoolCode > 0).map(item => item.schoolCode);
                const existingDistricts = yield district_model_1.default.find({ code: { $in: districtCodes } });
                const existingSchools = yield school_model_1.default.find({ code: { $in: schoolCodes } });
                const schoolMap = new Map(existingSchools.map(s => [s.code, s]));
                const districtMap = new Map(existingDistricts.map(d => [d.code, d]));
                // Create teachers
                const teachersToCreate = newTeachers.map(teacherData => {
                    const school = schoolMap.get(teacherData.schoolCode);
                    const district = districtMap.get(teacherData.districtCode);
                    return {
                        code: teacherData.code,
                        fullname: teacherData.fullname,
                        school: school === null || school === void 0 ? void 0 : school._id,
                        district: district === null || district === void 0 ? void 0 : district._id,
                        active: true
                    };
                });
                const createdTeachers = yield teacher_model_1.default.insertMany(teachersToCreate);
                processedData.push(...createdTeachers.map(t => t.toObject()));
                // Clean up
                (0, file_service_1.deleteFile)(filePath);
                return {
                    processedData,
                    errors: incorrectTeacherCodes.map(code => `Invalid teacher code: ${code}`),
                    skippedItems: existingTeacherCodes.map(code => ({ code, reason: 'Already exists' }))
                };
            }
            catch (error) {
                (0, file_service_1.deleteFile)(filePath);
                throw error;
            }
        });
    }
    repairTeacherAssignments() {
        return __awaiter(this, void 0, void 0, function* () {
            const teachers = yield teacher_model_1.default.find({});
            const repairedTeachers = [];
            const teachersWithoutSchool = [];
            const bulkOps = [];
            for (const teacher of teachers) {
                const teacherCode = teacher.code.toString();
                if (teacherCode.length !== 7) {
                    continue;
                }
                let isUpdated = false;
                let newDistrictId = null;
                let newSchoolId = null;
                // Check and fix district
                if (!teacher.district) {
                    const districtCode = teacherCode.substring(0, 3);
                    const district = yield district_model_1.default.findOne({ code: parseInt(districtCode) });
                    if (district) {
                        newDistrictId = district._id;
                        isUpdated = true;
                    }
                }
                // Check and fix school
                if (!teacher.school) {
                    const schoolCode = teacherCode.substring(0, 5);
                    const school = yield school_model_1.default.findOne({ code: parseInt(schoolCode) });
                    if (school) {
                        newSchoolId = school._id;
                        isUpdated = true;
                    }
                    else {
                        teachersWithoutSchool.push(teacher.code);
                    }
                }
                if (isUpdated) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: teacher._id },
                            update: { $set: { district: newDistrictId, school: newSchoolId } }
                        }
                    });
                    repairedTeachers.push(teacher.code);
                }
            }
            if (bulkOps.length > 0) {
                yield teacher_model_1.default.bulkWrite(bulkOps);
            }
            return { repairedTeachers, teachersWithoutSchool };
        });
    }
    checkExistingTeacherCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            const existingCodes = yield teacher_model_1.default.distinct("code", { code: { $in: codes } });
            return existingCodes;
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.districtIds && filters.districtIds.length > 0 && (!filters.schoolIds || filters.schoolIds.length === 0)) {
            filter.district = { $in: filters.districtIds };
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 7);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        if (filters.active !== undefined) {
            filter.active = filters.active;
        }
        return filter;
    }
}
exports.TeacherService = TeacherService;
// Legacy functions for backward compatibility
const teacherService = new TeacherService();
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
    return yield teacherService.checkExistingTeacherCodes(codes);
});
exports.checkExistingTeacherCodes = checkExistingTeacherCodes;
const getFiltredTeachers = (req) => __awaiter(void 0, void 0, void 0, function* () {
    const pagination = request_parser_util_1.RequestParser.parsePagination(req);
    const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
    const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
    return yield teacherService.getFilteredTeachers(pagination, filters, sort);
});
exports.getFiltredTeachers = getFiltredTeachers;
const deleteTeacherById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    return yield teacherService.delete(id);
});
exports.deleteTeacherById = deleteTeacherById;
const deleteTeachersByIds = (ids) => __awaiter(void 0, void 0, void 0, function* () {
    const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
    return yield teacherService.deleteBulk(objectIds);
});
exports.deleteTeachersByIds = deleteTeachersByIds;
