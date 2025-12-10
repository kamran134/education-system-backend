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
            var _a, _b, _c;
            // Сначала обнуляем статистику всех школ
            console.log("🧹 Обнуляем статистику школ...");
            yield school_model_1.default.updateMany({}, {
                score: 0,
                averageScore: 0,
                $unset: { place: "" }
            });
            // Получаем всех студентов с school и score
            const students = yield student_model_1.default.find({}, { school: 1, score: 1 }).populate('school', 'studentCount');
            // Группируем по school
            const statsMap = new Map();
            for (const student of students) {
                const schoolId = (_b = (_a = student.school) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString();
                if (!schoolId)
                    continue;
                const score = typeof student.score === 'number' ? student.score : 0;
                if (!statsMap.has(schoolId)) {
                    statsMap.set(schoolId, { sum: 0, studentCount: ((_c = student.school) === null || _c === void 0 ? void 0 : _c.studentCount) || 0 });
                }
                const stat = statsMap.get(schoolId);
                stat.sum += score;
            }
            // Обновляем каждую школу
            for (const [schoolId, { sum, studentCount }] of statsMap.entries()) {
                const average = studentCount > 0 ? sum / studentCount : 0;
                yield school_model_1.default.findByIdAndUpdate(schoolId, {
                    score: sum,
                    averageScore: average
                });
            }
            // ЗАКОММЕНТИРОВАНО: Обновление studentCount из суммы учителей (количество студентов устанавливается только вручную или через Excel)
            // console.log("👥 Обновляем количество студентов школ из суммы учителей...");
            // await this.updateSchoolStudentCountFromTeachers();
            // Обновляем место в рейтинге (place) для всех школ
            console.log("🏆 Обновляем рейтинг школ (place)...");
            yield this.updateSchoolPlaces();
        });
    }
    /**
     * ЗАКОММЕНТИРОВАНО: Обновляет studentCount школ из суммы studentCount их учителей
     * (количество студентов устанавливается только вручную или через Excel)
     */
    /*
    private async updateSchoolStudentCountFromTeachers(): Promise<void> {
        try {
            // Получаем агрегацию по школам с суммой studentCount учителей
            const schoolStats = await Teacher.aggregate([
                { $match: { school: { $exists: true, $ne: null }, active: true } },
                {
                    $group: {
                        _id: "$school",
                        totalStudentCount: { $sum: "$studentCount" }
                    }
                }
            ]);

            // Подготавливаем bulk операции для обновления
            const bulkOperations = schoolStats.map(stat => ({
                updateOne: {
                    filter: { _id: stat._id },
                    update: { $set: { studentCount: stat.totalStudentCount } }
                }
            }));

            if (bulkOperations.length > 0) {
                await School.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено studentCount для ${bulkOperations.length} школ`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении studentCount школ:", error);
        }
    }
    */
    /**
     * Обновляет место в рейтинге (place) для всех школ на основе их averageScore
     */
    updateSchoolPlaces() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Получаем все школы, отсортированные по averageScore в убывающем порядке
                const schools = yield school_model_1.default.find({
                    active: true,
                    averageScore: { $gt: 0 } // Только школы с баллом больше 0
                })
                    .sort({ averageScore: -1, code: 1 }) // сортируем по averageScore убывание, при равенстве по коду
                    .select('_id averageScore code');
                if (schools.length === 0) {
                    console.log("Нет школ с averageScore > 0 для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 1; // Начинаем с 1
                let previousScore = null;
                for (let i = 0; i < schools.length; i++) {
                    const school = schools[i];
                    // Если это первая школа или балл изменился
                    if (i > 0 && previousScore !== null && school.averageScore < previousScore) {
                        // Место = текущая позиция + 1
                        currentPlace = i + 1;
                    }
                    // Если балл такой же, как у предыдущей, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: school._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = school.averageScore;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield school_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} школ`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении места в рейтинге школ:", error);
                throw error;
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
            // Remove empty _id if present
            const cleanData = Object.assign({}, schoolData);
            if ('_id' in cleanData && (!cleanData._id || cleanData._id === '')) {
                delete cleanData._id;
            }
            const school = new school_model_1.default(cleanData);
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
                    .collation({ locale: 'az', strength: 2 })
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
                if (!data || data.length < 5) {
                    throw new Error('Faylda kifayət qədər sətr yoxdur!');
                }
                const rows = data.slice(4); // Skip header rows (first 4 rows)
                const dataToInsert = rows.map(row => ({
                    districtCode: Number(row[1]) || 0,
                    code: Number(row[2]),
                    name: String(row[3]),
                    address: ''
                }));
                // Filter correct schools (school code must be 5 digits: 10000-99999)
                const correctSchoolsToInsert = dataToInsert.filter(data => data.code > 9999);
                const incorrectSchoolCodes = dataToInsert
                    .filter(data => data.code <= 9999)
                    .map(data => data.code);
                // Check existing schools
                const existingSchoolCodes = yield this.checkExistingSchoolCodes(correctSchoolsToInsert.map(data => data.code));
                const newSchools = existingSchoolCodes.length > 0
                    ? correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code))
                    : correctSchoolsToInsert;
                // Separate schools without district codes
                const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
                const schoolCodesWithoutDistrictCodes = newSchools
                    .filter(item => item.districtCode === 0)
                    .map(item => item.code);
                // Check which districts exist
                const existingDistricts = yield district_model_1.default.find({ code: { $in: districtCodes } });
                const existingDistrictCodes = existingDistricts.map(d => d.code);
                const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));
                const districtMap = new Map(existingDistricts.map(d => [d.code, d._id]));
                // Filter schools to save (only those with valid district)
                const schoolsToSave = newSchools.filter(item => item.code > 0 &&
                    !missingDistrictCodes.includes(item.districtCode) &&
                    !schoolCodesWithoutDistrictCodes.includes(item.code)).map(item => ({
                    name: item.name,
                    address: item.address,
                    code: item.code,
                    districtCode: item.districtCode,
                    district: districtMap.get(item.districtCode),
                    active: true
                }));
                // Save schools using bulkWrite with upsert
                if (schoolsToSave.length > 0) {
                    const results = yield school_model_1.default.collection.bulkWrite(schoolsToSave.map(school => ({
                        updateOne: {
                            filter: { code: school.code },
                            update: { $set: school },
                            upsert: true
                        }
                    })));
                    // Fetch created/updated schools for response
                    const createdCodes = schoolsToSave.map(s => s.code);
                    const savedSchools = yield school_model_1.default.find({ code: { $in: createdCodes } });
                    processedData.push(...savedSchools.map(s => s.toObject()));
                }
                // Clean up
                (0, file_service_1.deleteFile)(filePath);
                return {
                    processedData,
                    errors,
                    skippedItems,
                    validationErrors: {
                        incorrectSchoolCodes,
                        missingDistrictCodes: [...new Set(missingDistrictCodes)],
                        schoolCodesWithoutDistrictCodes,
                        existingSchoolCodes
                    }
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
        const filter = { active: true }; // По умолчанию только активные
        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 5);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        if (filters.search) {
            // Search by school name (case-insensitive)
            filter.name = { $regex: filters.search, $options: 'i' };
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
