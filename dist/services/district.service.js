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
exports.countDistrictsRates = exports.checkExistingDistrictCodes = exports.checkExistingDistricts = exports.checkExistingDistrict = exports.DistrictService = void 0;
const district_model_1 = __importDefault(require("../models/district.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const request_parser_util_1 = require("../utils/request-parser.util");
const excel_service_1 = require("./excel.service");
const file_service_1 = require("./file.service");
class DistrictService {
    /**
     * Обновляет статистику по районам: studentCount, score, averageScore
     */
    updateDistrictsStats() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            // Сначала обнуляем статистику всех районов
            console.log("🧹 Обнуляем статистику районов...");
            yield district_model_1.default.updateMany({}, {
                score: 0,
                averageScore: 0,
            });
            // Получаем всех студентов с district и score
            const students = yield student_model_1.default.find({}, { district: 1, score: 1 }).populate('district', 'studentCount');
            // Группируем по district
            const statsMap = new Map();
            for (const student of students) {
                const districtId = (_b = (_a = student.district) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString();
                if (!districtId)
                    continue;
                const score = typeof student.score === 'number' ? student.score : 0;
                if (!statsMap.has(districtId)) {
                    statsMap.set(districtId, { sum: 0, studentCount: ((_c = student.district) === null || _c === void 0 ? void 0 : _c.studentCount) || 0 });
                }
                const stat = statsMap.get(districtId);
                stat.sum += score;
            }
            // Обновляем каждый район
            for (const [districtId, { sum, studentCount }] of statsMap.entries()) {
                const average = studentCount > 0 ? sum / studentCount : 0;
                yield district_model_1.default.findByIdAndUpdate(districtId, {
                    score: sum,
                    averageScore: average
                });
            }
            // ЗАКОММЕНТИРОВАНО: Обновление studentCount из суммы школ (количество студентов устанавливается только вручную или через Excel)
            // console.log("👥 Обновляем количество студентов районов из суммы школ...");
            // await this.updateDistrictStudentCountFromSchools();
            // Обновляем место в рейтинге (place) для всех районов
            console.log("🏆 Обновляем рейтинг районов (place)...");
            yield this.updateDistrictPlaces();
        });
    }
    /**
     * ЗАКОММЕНТИРОВАНО: Обновляет studentCount районов из суммы studentCount их школ
     * (количество студентов устанавливается только вручную или через Excel)
     */
    /*
    private async updateDistrictStudentCountFromSchools(): Promise<void> {
        try {
            // Получаем агрегацию по районам с суммой studentCount школ
            const districtStats = await School.aggregate([
                { $match: { district: { $exists: true, $ne: null }, active: true } },
                {
                    $group: {
                        _id: "$district",
                        totalStudentCount: { $sum: "$studentCount" }
                    }
                }
            ]);

            // Подготавливаем bulk операции для обновления
            const bulkOperations = districtStats.map(stat => ({
                updateOne: {
                    filter: { _id: stat._id },
                    update: { $set: { studentCount: stat.totalStudentCount } }
                }
            }));

            if (bulkOperations.length > 0) {
                await District.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено studentCount для ${bulkOperations.length} районов`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении studentCount районов:", error);
        }
    }
    */
    /**
     * Обновляет место в рейтинге (place) для всех районов на основе их averageScore
     */
    updateDistrictPlaces() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log("🔍 DEBUG: Начинаем обновление мест районов...");
                // Получаем все районы, отсортированные по averageScore в убывающем порядке
                const districts = yield district_model_1.default.find({ averageScore: { $exists: true } })
                    .sort({ averageScore: -1, code: 1 }) // сортируем по averageScore убывание, при равенстве по коду
                    .select('_id averageScore code active');
                console.log(`🔍 DEBUG: Найдено ${districts.length} районов с averageScore`);
                if (districts.length > 0) {
                    console.log(`🔍 DEBUG: Первые 3 района:`, districts.slice(0, 3).map(d => `${d.code}: ${d.averageScore} (active: ${d.active})`));
                }
                if (districts.length === 0) {
                    console.log("❌ Нет районов с averageScore для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 0;
                let previousScore = null;
                for (let i = 0; i < districts.length; i++) {
                    const district = districts[i];
                    // Если это первый район или балл изменился
                    if (i === 0 || (previousScore !== null && district.averageScore < previousScore)) {
                        // Место = позиция в отсортированном списке + 1
                        currentPlace++;
                    }
                    // Если балл такой же, как у предыдущего, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: district._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = district.averageScore;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield district_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} районов`);
                    // Показываем статистику рейтинга
                    const topDistrict = districts[0];
                    const lastDistrict = districts[districts.length - 1];
                    console.log(`🥇 Лидер рейтинга районов: ${topDistrict.averageScore} баллов (место 1)`);
                    console.log(`📊 Всего в рейтинге: ${districts.length} районов`);
                    console.log(`🔢 Диапазон баллов: ${lastDistrict.averageScore} - ${topDistrict.averageScore}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении места в рейтинге районов:", error);
                throw error;
            }
        });
    }
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield district_model_1.default.findById(id);
        });
    }
    findByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield district_model_1.default.findOne({ code });
        });
    }
    create(districtData) {
        return __awaiter(this, void 0, void 0, function* () {
            const district = new district_model_1.default(districtData);
            return yield district.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedDistrict = yield district_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
            if (!updatedDistrict) {
                throw new Error('District not found');
            }
            return updatedDistrict;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            // Delete associated schools, teachers and students first
            const schools = yield school_model_1.default.find({ district: id });
            if (schools.length > 0) {
                const schoolIds = schools.map(s => s._id);
                // Delete teachers
                yield teacher_model_1.default.deleteMany({ school: { $in: schoolIds } });
                // Delete student results first, then students
                const students = yield student_model_1.default.find({ school: { $in: schoolIds } });
                if (students.length > 0) {
                    const studentIds = students.map(s => s._id);
                    yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
                    yield student_model_1.default.deleteMany({ school: { $in: schoolIds } });
                }
                // Delete schools
                yield school_model_1.default.deleteMany({ district: id });
            }
            const result = yield district_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('District not found');
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
    getFilteredDistricts(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                district_model_1.default.find(filter)
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                district_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    getDistrictsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            return yield district_model_1.default.find(filter)
                .sort({ name: 1 });
        });
    }
    processDistrictsFromExcel(filePath) {
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
                    studentCount: Number(row[3]) || 0
                }));
                // Filter valid districts
                const validDistricts = dataToInsert.filter(data => data.code > 0 && data.name);
                // Check existing districts
                const existingDistrictCodes = yield this.checkExistingDistrictCodes(validDistricts.map(data => data.code));
                const newDistricts = existingDistrictCodes.length > 0
                    ? validDistricts.filter(data => !existingDistrictCodes.includes(data.code))
                    : validDistricts;
                // Create districts
                const districtsToCreate = newDistricts.map(districtData => ({
                    code: districtData.code,
                    name: districtData.name,
                    studentCount: districtData.studentCount || 0,
                    active: true
                }));
                const createdDistricts = yield district_model_1.default.insertMany(districtsToCreate);
                processedData.push(...createdDistricts.map(d => d.toObject()));
                // Обновляем studentCount для существующих районов из Excel
                if (existingDistrictCodes.length > 0) {
                    const existingDistrictsToUpdate = validDistricts.filter(data => existingDistrictCodes.includes(data.code));
                    const bulkUpdateOperations = existingDistrictsToUpdate.map(districtData => ({
                        updateOne: {
                            filter: { code: districtData.code },
                            update: { $set: { studentCount: districtData.studentCount || 0 } }
                        }
                    }));
                    if (bulkUpdateOperations.length > 0) {
                        yield district_model_1.default.bulkWrite(bulkUpdateOperations);
                        console.log(`✅ Обновлено studentCount для ${bulkUpdateOperations.length} существующих районов`);
                    }
                }
                // Clean up
                (0, file_service_1.deleteFile)(filePath);
                return {
                    processedData,
                    errors,
                    skippedItems: existingDistrictCodes.map(code => ({ code, reason: 'Already exists' }))
                };
            }
            catch (error) {
                (0, file_service_1.deleteFile)(filePath);
                throw error;
            }
        });
    }
    checkExistingDistrictCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            const existingCodes = yield district_model_1.default.distinct("code", { code: { $in: codes } });
            return existingCodes;
        });
    }
    countDistrictsRates() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                console.log("🔄 Подсчёт коэффициентов районов...");
                const studentResults = yield studentResult_model_1.default.find().populate("student exam");
                const districtCounts = new Map();
                const examDistrictIds = new Set();
                for (const result of studentResults) {
                    const districtId = (_a = result.student.district) === null || _a === void 0 ? void 0 : _a.toString();
                    const examId = (_b = result.exam) === null || _b === void 0 ? void 0 : _b.toString();
                    if (districtId && examId) {
                        const key = `${districtId}-${examId}`;
                        if (!examDistrictIds.has(key)) {
                            examDistrictIds.add(key);
                            districtCounts.set(districtId, (districtCounts.get(districtId) || 0) + 1);
                        }
                    }
                }
                // Update districts with counts
                for (const [districtId, count] of districtCounts.entries()) {
                    yield district_model_1.default.findByIdAndUpdate(districtId, {
                        examCount: count,
                        updatedAt: new Date()
                    });
                }
                console.log("✅ Коэффициенты районов обновлены");
            }
            catch (error) {
                console.error("Ошибка при подсчёте коэффициентов:", error);
                throw new Error("Не удалось подсчитать коэффициенты районов!");
            }
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 2);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        if (filters.active !== undefined) {
            filter.active = filters.active;
        }
        return filter;
    }
}
exports.DistrictService = DistrictService;
// Legacy functions for backward compatibility
const districtService = new DistrictService();
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
    return yield districtService.checkExistingDistrictCodes(codes);
});
exports.checkExistingDistrictCodes = checkExistingDistrictCodes;
const countDistrictsRates = () => __awaiter(void 0, void 0, void 0, function* () {
    return yield districtService.countDistrictsRates();
});
exports.countDistrictsRates = countDistrictsRates;
