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
exports.updateStats = exports.resetStats = exports.StatsService = void 0;
const exam_model_1 = __importDefault(require("../models/exam.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const levelScore_enum_1 = require("../types/levelScore.enum");
const studentResult_service_1 = require("./studentResult.service");
const district_service_1 = require("./district.service");
const request_parser_util_1 = require("../utils/request-parser.util");
class StatsService {
    // Функция для проверки, является ли уровень лицейным
    isLiceyLevel(level) {
        const normalizedLevel = level.trim().toUpperCase();
        return normalizedLevel === 'LISEY' || normalizedLevel === 'LISE' || normalizedLevel.includes('LISEY');
    }
    resetStats() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("🔄 Сброс статистики...");
            yield district_model_1.default.updateMany({}, { score: 0, averageScore: 0, rate: 0 });
            // Reset status and recalculate base score from level mapping.
            // Use aggregation-style pipeline update (MongoDB 4.2+) to derive numeric score from level.
            yield studentResult_model_1.default.updateMany({}, [
                {
                    $set: {
                        status: "",
                        score: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$level", "E"] }, then: levelScore_enum_1.LevelScore.E },
                                    { case: { $eq: ["$level", "D"] }, then: levelScore_enum_1.LevelScore.D },
                                    { case: { $eq: ["$level", "C"] }, then: levelScore_enum_1.LevelScore.C },
                                    { case: { $eq: ["$level", "B"] }, then: levelScore_enum_1.LevelScore.B },
                                    { case: { $eq: ["$level", "A"] }, then: levelScore_enum_1.LevelScore.A },
                                    { case: { $in: ["$level", ["Lisey", "Lise", "Lisey "]] }, then: levelScore_enum_1.LevelScore.Lisey }
                                ],
                                default: 0
                            }
                        }
                    }
                }
            ]); // cast as any to satisfy TS for pipeline form
            console.log("✅ Статистика сброшена.");
        });
    }
    updateStatsOld() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Reset all statistics
                yield this.resetStats();
                yield (0, district_service_1.countDistrictsRates)();
                // Get all exam dates
                const exams = yield exam_model_1.default.find({}, { date: 1 });
                if (!exams.length) {
                    console.log("Нет экзаменов в базе.");
                    return 404;
                }
                // Create unique months set
                const uniqueMonths = new Set();
                for (const exam of exams) {
                    const date = new Date(exam.date);
                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;
                    uniqueMonths.add(`${year}-${month}`);
                }
                // Sort months chronologically
                const sortedMonths = Array.from(uniqueMonths)
                    .map(m => {
                    const [year, month] = m.split("-").map(Number);
                    return { year, month, key: `${year}-${month}` };
                })
                    .sort((a, b) => {
                    if (a.year !== b.year)
                        return a.year - b.year;
                    return a.month - b.month;
                });
                console.log(`Найдено ${sortedMonths.length} уникальных месяцев с экзаменами.`);
                // Process each month sequentially
                for (const monthData of sortedMonths) {
                    console.log(`🔄 Обработка месяца: ${monthData.key}...`);
                    yield (0, studentResult_service_1.markDevelopingStudents)(monthData.month, monthData.year);
                    yield (0, studentResult_service_1.markTopStudents)(monthData.month, monthData.year);
                    yield (0, studentResult_service_1.markTopStudentsRepublic)(monthData.month, monthData.year);
                }
                // Final processing for all developing students
                yield (0, studentResult_service_1.markAllDevelopingStudents)();
                yield (0, district_service_1.countDistrictsRates)();
                console.log("✅ Статистика обновлена успешно.");
                return 200;
            }
            catch (error) {
                console.error("Ошибка при обновлении статистики:", error);
                throw error;
            }
        });
    }
    updateStats() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log("🔄 Начинаем обновление статистики...");
                // Получаем текущую дату
                const currentDate = new Date();
                const currentMonth = currentDate.getMonth() + 1;
                const currentYear = currentDate.getFullYear();
                console.log(`📅 Обрабатываем месяц: ${currentMonth}/${currentYear}`);
                // Шаг 1: Получаем все результаты студентов за текущий месяц
                const studentResults = yield studentResult_model_1.default.find({
                    month: currentMonth,
                    year: currentYear
                }).populate({
                    path: 'student',
                    populate: {
                        path: 'district'
                    }
                });
                if (studentResults.length === 0) {
                    console.log("❌ Нет результатов за текущий месяц");
                    return 404;
                }
                console.log(`📊 Найдено ${studentResults.length} результатов за ${currentMonth}/${currentYear}`);
                // Шаг 2: Обнуляем studentOfTheMonthScore и republicWideStudentOfTheMonthScore
                console.log("🔄 Обнуляем баллы студентов месяца...");
                yield studentResult_model_1.default.updateMany({ month: currentMonth, year: currentYear }, {
                    $set: {
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0
                    }
                });
                // Шаг 3: Группируем по классам (grade) и районам (district)
                console.log("🔄 Группируем результаты по классам и районам...");
                const gradeDistrictGroups = new Map();
                const gradeGroups = new Map();
                for (const result of studentResults) {
                    if (!result.student || !result.student.district)
                        continue;
                    const grade = result.grade;
                    const districtId = result.student.district._id.toString();
                    const gradeDistrictKey = `${grade}-${districtId}`;
                    // Группировка по классам и районам
                    if (!gradeDistrictGroups.has(gradeDistrictKey)) {
                        gradeDistrictGroups.set(gradeDistrictKey, []);
                    }
                    gradeDistrictGroups.get(gradeDistrictKey).push(result);
                    // Группировка только по классам (для республиканского уровня)
                    if (!gradeGroups.has(grade)) {
                        gradeGroups.set(grade, []);
                    }
                    gradeGroups.get(grade).push(result);
                }
                // Шаг 4: Находим лучших студентов в каждом классе и районе
                console.log("🏆 Определяем лучших студентов месяца по районам...");
                const districtTopStudentUpdates = [];
                for (const [gradeDistrictKey, results] of gradeDistrictGroups.entries()) {
                    const [grade, districtId] = gradeDistrictKey.split('-');
                    // Находим максимальный totalScore в этой группе
                    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                    // Находим всех студентов с максимальным баллом
                    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                    // Проверяем, есть ли среди них лицейные студенты
                    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                    if (liceyStudentsWithMaxScore.length > 0) {
                        // Если есть лицейные студенты с максимальным баллом, награждаем только их
                        console.log(`📍 Класс ${grade}, район ${districtId}: максимум ${maxTotalScore} баллов (лицейный уровень), ${liceyStudentsWithMaxScore.length} студент(ов)`);
                        for (const student of liceyStudentsWithMaxScore) {
                            districtTopStudentUpdates.push({
                                updateOne: {
                                    filter: { _id: student._id },
                                    update: { $set: { studentOfTheMonthScore: 5 } }
                                }
                            });
                        }
                    }
                    else {
                        // Если нет лицейных с максимальным баллом, никого не награждаем
                        console.log(`📍 Класс ${grade}, район ${districtId}: максимум ${maxTotalScore} баллов (не лицейный уровень), никого не награждаем`);
                    }
                }
                // Применяем обновления для студентов месяца по районам
                if (districtTopStudentUpdates.length > 0) {
                    yield studentResult_model_1.default.bulkWrite(districtTopStudentUpdates);
                    console.log(`✅ Обновлено ${districtTopStudentUpdates.length} студентов месяца по районам`);
                }
                // Шаг 5: Находим лучших студентов в каждом классе по всей республике
                console.log("🏆 Определяем лучших студентов месяца по республике...");
                const republicTopStudentUpdates = [];
                for (const [grade, results] of gradeGroups.entries()) {
                    // Находим максимальный totalScore в этом классе по всей республике
                    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                    // Находим всех студентов с максимальным баллом
                    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                    // Проверяем, есть ли среди них лицейные студенты
                    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                    if (liceyStudentsWithMaxScore.length > 0) {
                        // Если есть лицейные студенты с максимальным баллом, награждаем только их
                        console.log(`🎯 Класс ${grade} (республика): максимум ${maxTotalScore} баллов (лицейный уровень), ${liceyStudentsWithMaxScore.length} студент(ов)`);
                        for (const student of liceyStudentsWithMaxScore) {
                            republicTopStudentUpdates.push({
                                updateOne: {
                                    filter: { _id: student._id },
                                    update: { $set: { republicWideStudentOfTheMonthScore: 5 } }
                                }
                            });
                        }
                    }
                    else {
                        // Если нет лицейных с максимальным баллом, никого не награждаем
                        console.log(`🎯 Класс ${grade} (республика): максимум ${maxTotalScore} баллов (не лицейный уровень), никого не награждаем`);
                    }
                }
                // Применяем обновления для студентов месяца по республике
                if (republicTopStudentUpdates.length > 0) {
                    yield studentResult_model_1.default.bulkWrite(republicTopStudentUpdates);
                    console.log(`✅ Обновлено ${republicTopStudentUpdates.length} студентов месяца по республике`);
                }
                // Шаг 6: Подсчитываем общий score для всех студентов
                console.log("🔢 Подсчитываем общий score для студентов...");
                yield this.updateStudentScores();
                // // Шаг 6.1: Обновляем статистику для учителей, школ и районов
                // console.log("👨‍🏫 Обновляем статистику учителей...");
                // const teacherService = new TeacherService();
                // await teacherService.updateTeachersStats();
                // console.log("🏫 Обновляем статистику школ...");
                // const schoolService = new SchoolService();
                // await schoolService.updateSchoolsStats();
                // console.log("🏛️ Обновляем статистику районов...");
                // const districtService = new DistrictService();
                // await districtService.updateDistrictsStats();
                // Шаг 7: Обновляем место в рейтинге (place) для всех студентов
                console.log("🏆 Обновляем рейтинг студентов (place)...");
                yield this.updateStudentPlaces();
                // // Шаг 8: Назначаем учителей года
                // console.log("👨‍🏫 Назначаем учителей года...");
                // await this.updateTeachersOfTheYear();
                // // Шаг 9: Назначаем школы года
                // console.log("🏫 Назначаем школы года...");
                // await this.updateSchoolsOfTheYear();
                // // Шаг 10: Назначаем районы года
                // console.log("🏛️ Назначаем районы года...");
                // await this.updateDistrictsOfTheYear();
                console.log("✅ Статистика обновлена успешно!");
                return 200;
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении статистики:", error);
                throw error;
            }
        });
    }
    getStudentStatistics(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filters.month) {
                throw new Error('Month is required');
            }
            const { startDate, endDate } = request_parser_util_1.RequestParser.parseMonthRange(filters.month);
            let examIds;
            if (filters.examIds && filters.examIds.length > 0) {
                examIds = filters.examIds;
            }
            else {
                const exams = yield exam_model_1.default.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
                examIds = exams.map(e => e._id);
            }
            if (examIds.length === 0) {
                throw new Error('No exams found for the specified month');
            }
            // Build aggregation pipeline
            const pipeline = this.buildStudentStatsPipeline(filters, examIds);
            const studentResults = yield studentResult_model_1.default.aggregate(pipeline);
            // Используем числовые поля вместо поиска в статусе
            const studentsOfMonth = studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
            const studentsOfMonthByRepublic = studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
            const developingStudents = studentResults.filter(r => r.developmentScore && r.developmentScore > 0);
            return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
        });
    }
    // Отдельный метод для получения развивающихся студентов
    getDevelopingStudents(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filters.month) {
                throw new Error('Month is required');
            }
            const { startDate, endDate } = request_parser_util_1.RequestParser.parseMonthRange(filters.month);
            let examIds;
            if (filters.examIds && filters.examIds.length > 0) {
                examIds = filters.examIds;
            }
            else {
                const exams = yield exam_model_1.default.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
                examIds = exams.map(e => e._id);
            }
            if (examIds.length === 0) {
                throw new Error('No exams found for the specified month');
            }
            // Build aggregation pipeline
            const pipeline = this.buildStudentStatsPipeline(filters, examIds);
            const studentResults = yield studentResult_model_1.default.aggregate(pipeline);
            // Фильтруем только развивающихся студентов
            return studentResults.filter(r => r.developmentScore && r.developmentScore > 0);
        });
    }
    // Отдельный метод для получения студентов месяца
    getStudentsOfMonth(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filters.month) {
                throw new Error('Month is required');
            }
            const { startDate, endDate } = request_parser_util_1.RequestParser.parseMonthRange(filters.month);
            let examIds;
            if (filters.examIds && filters.examIds.length > 0) {
                examIds = filters.examIds;
            }
            else {
                const exams = yield exam_model_1.default.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
                examIds = exams.map(e => e._id);
            }
            if (examIds.length === 0) {
                throw new Error('No exams found for the specified month');
            }
            // Build aggregation pipeline
            const pipeline = this.buildStudentStatsPipeline(filters, examIds);
            const studentResults = yield studentResult_model_1.default.aggregate(pipeline);
            // Фильтруем только студентов месяца (по районам)
            return studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
        });
    }
    // Отдельный метод для получения студентов месяца по республике
    getStudentsOfMonthByRepublic(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filters.month) {
                throw new Error('Month is required');
            }
            const { startDate, endDate } = request_parser_util_1.RequestParser.parseMonthRange(filters.month);
            let examIds;
            if (filters.examIds && filters.examIds.length > 0) {
                examIds = filters.examIds;
            }
            else {
                const exams = yield exam_model_1.default.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
                examIds = exams.map(e => e._id);
            }
            if (examIds.length === 0) {
                throw new Error('No exams found for the specified month');
            }
            // Build aggregation pipeline
            const pipeline = this.buildStudentStatsPipeline(filters, examIds);
            const studentResults = yield studentResult_model_1.default.aggregate(pipeline);
            // Фильтруем только студентов месяца по республике
            return studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
        });
    }
    getStatisticsByExam(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            const studentResults = yield studentResult_model_1.default.find({ exam: examId })
                .populate("exam")
                .populate({
                path: "student",
                populate: [
                    { path: "district", model: "District" },
                    { path: "school", model: "School" },
                    { path: "teacher", model: "Teacher" }
                ]
            });
            // Используем числовые поля вместо поиска в статусе
            const studentsOfMonth = studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
            const studentsOfMonthByRepublic = studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
            const developingStudents = studentResults.filter(r => r.developmentScore && r.developmentScore > 0);
            return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
        });
    }
    getTeacherStatistics(filters, sortColumn, sortDirection) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = { active: true };
            if (filters.districtIds && filters.districtIds.length > 0) {
                filter.district = { $in: filters.districtIds };
            }
            if (filters.schoolIds && filters.schoolIds.length > 0) {
                filter.school = { $in: filters.schoolIds };
            }
            const sortOptions = {};
            sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
            const page = filters.page || 1;
            const size = filters.size || 100;
            const skip = (page - 1) * size;
            const [data, totalCount] = yield Promise.all([
                teacher_model_1.default
                    .find(filter)
                    .populate("school")
                    .populate({ path: "school", populate: { path: "district", model: "District" } })
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(size),
                teacher_model_1.default.countDocuments(filter)
            ]);
            // Добавляем значения по умолчанию для отсутствующих полей
            data.forEach(teacher => {
                if (teacher.score === undefined || teacher.score === null) {
                    teacher.score = 0;
                }
                if (teacher.averageScore === undefined || teacher.averageScore === null) {
                    teacher.averageScore = 0;
                }
                if (teacher.studentCount === undefined || teacher.studentCount === null) {
                    teacher.studentCount = 0;
                }
                if (teacher.place === undefined || teacher.place === null) {
                    teacher.place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
                }
            });
            return { data, totalCount };
        });
    }
    getSchoolStatistics(filters, sortColumn, sortDirection) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = { active: true };
            if (filters.districtIds && filters.districtIds.length > 0) {
                filter.district = { $in: filters.districtIds };
            }
            const sortOptions = {};
            sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
            const page = filters.page || 1;
            const size = filters.size || 100;
            const skip = (page - 1) * size;
            const [data, totalCount] = yield Promise.all([
                school_model_1.default
                    .find(filter)
                    .populate("district")
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(size),
                school_model_1.default.countDocuments(filter)
            ]);
            // Добавляем значения по умолчанию для отсутствующих полей
            data.forEach(school => {
                if (school.score === undefined || school.score === null) {
                    school.score = 0;
                }
                if (school.averageScore === undefined || school.averageScore === null) {
                    school.averageScore = 0;
                }
                if (school.studentCount === undefined || school.studentCount === null) {
                    school.studentCount = 0;
                }
                if (school.place === undefined || school.place === null) {
                    school.place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
                }
            });
            return { data, totalCount };
        });
    }
    getDistrictStatistics(filters, sortColumn, sortDirection) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = {};
            if (filters.code) {
                const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 3);
                filter.code = { $gte: start, $lte: end };
            }
            const sortOptions = {};
            sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
            const page = filters.page || 1;
            const size = filters.size || 100;
            const skip = (page - 1) * size;
            const [data, totalCount] = yield Promise.all([
                district_model_1.default
                    .find(filter)
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(size),
                district_model_1.default.countDocuments(filter)
            ]);
            // Добавляем значения по умолчанию для отсутствующих полей
            data.forEach(district => {
                if (district.score === undefined || district.score === null) {
                    district.score = 0;
                }
                if (district.averageScore === undefined || district.averageScore === null) {
                    district.averageScore = 0;
                }
                if (district.studentCount === undefined || district.studentCount === null) {
                    district.studentCount = 0;
                }
                if (district.place === undefined || district.place === null) {
                    district.place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
                }
            });
            return { data, totalCount };
        });
    }
    buildStudentStatsPipeline(filters, examIds) {
        let codeString = '';
        let codeStringEnd = '';
        if (filters.code) {
            codeString = filters.code.toString().padEnd(10, '0');
            codeStringEnd = filters.code.toString().padEnd(10, '9');
        }
        const pipeline = [
            // Filter results by exam month
            { $match: { exam: { $in: examIds } } },
            // Join with student data
            {
                $lookup: {
                    from: 'students',
                    localField: 'student',
                    foreignField: '_id',
                    as: 'studentData'
                }
            },
            { $unwind: '$studentData' },
            // Join with related data
            {
                $lookup: {
                    from: 'districts',
                    localField: 'studentData.district',
                    foreignField: '_id',
                    as: 'studentData.district'
                }
            },
            { $unwind: { path: '$studentData.district', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'schools',
                    localField: 'studentData.school',
                    foreignField: '_id',
                    as: 'studentData.school'
                }
            },
            { $unwind: { path: '$studentData.school', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'teachers',
                    localField: 'studentData.teacher',
                    foreignField: '_id',
                    as: 'studentData.teacher'
                }
            },
            { $unwind: { path: '$studentData.teacher', preserveNullAndEmptyArrays: true } },
        ];
        // Apply filters
        const matchConditions = {};
        if (filters.districtIds && filters.districtIds.length > 0) {
            matchConditions['studentData.district._id'] = { $in: filters.districtIds };
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            matchConditions['studentData.school._id'] = { $in: filters.schoolIds };
        }
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            matchConditions['studentData.teacher._id'] = { $in: filters.teacherIds };
        }
        if (filters.grades && filters.grades.length > 0) {
            matchConditions['studentData.grade'] = { $in: filters.grades };
        }
        if (filters.code) {
            matchConditions['studentData.code'] = {
                $gte: parseInt(codeString),
                $lte: parseInt(codeStringEnd)
            };
        }
        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }
        // Join with exam data
        pipeline.push({
            $lookup: {
                from: 'exams',
                localField: 'exam',
                foreignField: '_id',
                as: 'examData'
            }
        });
        pipeline.push({ $unwind: '$examData' });
        return pipeline;
    }
    /**
     * Обновляет общий score для всех студентов на основе их результатов
     */
    updateStudentScores() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Агрегация для подсчета общего score каждого студента
                const pipeline = [
                    {
                        $group: {
                            _id: '$student',
                            totalParticipationScore: {
                                $sum: { $ifNull: ['$participationScore', 0] }
                            },
                            totalDevelopmentScore: {
                                $sum: { $ifNull: ['$developmentScore', 0] }
                            },
                            totalStudentOfTheMonthScore: {
                                $sum: { $ifNull: ['$studentOfTheMonthScore', 0] }
                            },
                            totalRepublicWideStudentOfTheMonthScore: {
                                $sum: { $ifNull: ['$republicWideStudentOfTheMonthScore', 0] }
                            }
                        }
                    },
                    {
                        $addFields: {
                            totalScore: {
                                $add: [
                                    '$totalParticipationScore',
                                    '$totalDevelopmentScore',
                                    '$totalStudentOfTheMonthScore',
                                    '$totalRepublicWideStudentOfTheMonthScore'
                                ]
                            }
                        }
                    }
                ];
                const studentScores = yield studentResult_model_1.default.aggregate(pipeline);
                if (studentScores.length === 0) {
                    console.log("Нет результатов для подсчета score студентов.");
                    return;
                }
                // Подготавливаем bulk операции для обновления студентов
                const bulkOperations = studentScores.map(scoreData => ({
                    updateOne: {
                        filter: { _id: scoreData._id },
                        update: {
                            $set: {
                                score: scoreData.totalScore,
                                participationScore: scoreData.totalParticipationScore,
                                developmentScore: scoreData.totalDevelopmentScore,
                                studentOfTheMonthScore: scoreData.totalStudentOfTheMonthScore,
                                republicWideStudentOfTheMonthScore: scoreData.totalRepublicWideStudentOfTheMonthScore
                            }
                        }
                    }
                }));
                // Выполняем массовое обновление студентов
                if (bulkOperations.length > 0) {
                    yield student_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлен общий score для ${bulkOperations.length} студентов`);
                    // Показываем статистику по баллам
                    const totalScoreSum = studentScores.reduce((sum, student) => sum + student.totalScore, 0);
                    const averageScore = totalScoreSum / studentScores.length;
                    console.log(`📊 Общая сумма баллов: ${totalScoreSum}, средний балл: ${averageScore.toFixed(2)}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении score студентов:", error);
                throw error;
            }
        });
    }
    /**
     * Обновляет место в рейтинге (place) для всех студентов на основе их score
     */
    updateStudentPlaces() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Получаем всех студентов, отсортированных по score в убывающем порядке
                const students = yield student_model_1.default.find({ score: { $exists: true } })
                    .sort({ score: -1, code: 1 }) // сортируем по score убывание, при равенстве по коду
                    .select('_id score');
                if (students.length === 0) {
                    console.log("Нет студентов с score для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 1;
                let previousScore = 0;
                for (let i = 0; i < students.length; i++) {
                    const student = students[i];
                    // Если это первый студент или балл изменился
                    if (student.score < previousScore) {
                        // Место = позиция в отсортированном списке + 1
                        currentPlace++;
                    }
                    // Если балл такой же, как у предыдущего, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: student._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = student.score;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield student_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} студентов`);
                    // Показываем статистику рейтинга
                    const topStudent = students[0];
                    const lastStudent = students[students.length - 1];
                    console.log(`🥇 Лидер рейтинга: ${topStudent.score} баллов (место 1)`);
                    console.log(`📊 Всего в рейтинге: ${students.length} студентов`);
                    console.log(`🔢 Диапазон баллов: ${lastStudent.score} - ${topStudent.score}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении места в рейтинге:", error);
                throw error;
            }
        });
    }
}
exports.StatsService = StatsService;
// Legacy function exports for backward compatibility
const statsService = new StatsService();
const resetStats = () => statsService.resetStats();
exports.resetStats = resetStats;
const updateStats = () => statsService.updateStats();
exports.updateStats = updateStats;
