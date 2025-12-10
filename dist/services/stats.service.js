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
exports.updateAllStats = exports.updateStats = exports.resetStats = exports.StatsService = void 0;
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
    // Функция для расчета мест с учетом одинаковых баллов
    assignPlaces(items, scoreField = 'averageScore') {
        if (items.length === 0)
            return items;
        // Сортируем по убыванию (высокий балл = лучшее место)
        items.sort((a, b) => {
            const scoreA = a[scoreField] || 0;
            const scoreB = b[scoreField] || 0;
            return scoreB - scoreA;
        });
        let currentPlace = 1;
        let previousScore = null;
        items.forEach((item, index) => {
            const currentScore = item[scoreField] || 0;
            if (index === 0) {
                // Первый элемент всегда место 1
                item.place = 1;
                previousScore = currentScore;
            }
            else if (currentScore < previousScore) {
                // Балл меньше предыдущего - новое место
                currentPlace++;
                item.place = currentPlace;
                previousScore = currentScore;
            }
            else {
                // Балл такой же - то же место
                item.place = currentPlace;
            }
        });
        return items;
    }
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
    /**
     * Обновляет статистику для всех месяцев учебного года (сентябрь-июнь)
     * Проходит по каждому месяцу от сентября до июня и вызывает обновление статистики
     * После завершения обновляет статистику районов, школ и учителей
     */
    updateAllStats() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log("🔄 Начинаем полное обновление статистики за весь учебный год...");
                // Получаем текущую дату для определения учебного года
                const currentDate = new Date();
                const currentMonth = currentDate.getMonth() + 1; // 1-12
                const currentYear = currentDate.getFullYear();
                // Определяем учебный год: если сейчас сентябрь-декабрь, то учебный год текущий->следующий
                // если январь-август, то учебный год предыдущий->текущий
                let academicYearStart;
                let academicYearEnd;
                if (currentMonth >= 9) { // сентябрь-декабрь
                    academicYearStart = currentYear;
                    academicYearEnd = currentYear + 1;
                }
                else { // январь-август
                    academicYearStart = currentYear - 1;
                    academicYearEnd = currentYear;
                }
                console.log(`📅 Учебный год: ${academicYearStart}/${academicYearEnd}`);
                // ============================================================
                // ШАГ 1: ОБНУЛЕНИЕ ВСЕХ БАЛЛОВ И СТАТИСТИКИ
                // ============================================================
                console.log("\n🔄 Обнуляем все баллы и статистику...");
                // Обнуляем баллы в результатах студентов (StudentResult)
                console.log("📝 Обнуляем баллы в результатах экзаменов...");
                yield studentResult_model_1.default.updateMany({}, {
                    $set: {
                        developmentScore: 0,
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0
                        // participationScore не трогаем - он всегда 1
                    }
                });
                console.log("✅ Баллы результатов обнулены");
                // Обнуляем баллы студентов
                console.log("👨‍🎓 Обнуляем баллы студентов...");
                yield student_model_1.default.updateMany({}, {
                    $set: {
                        score: 0,
                        averageScore: 0,
                        participationScore: 0,
                        developmentScore: 0,
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0,
                        place: null,
                        status: ''
                    }
                });
                console.log("✅ Баллы студентов обнулены");
                // Обнуляем баллы учителей
                console.log("👨‍🏫 Обнуляем баллы учителей...");
                yield teacher_model_1.default.updateMany({}, {
                    $set: {
                        score: 0,
                        averageScore: 0,
                        teacherOfTheYearScore: 0,
                        place: null,
                        status: ''
                    }
                });
                console.log("✅ Баллы учителей обнулены");
                // Обнуляем баллы школ
                console.log("🏫 Обнуляем баллы школ...");
                yield school_model_1.default.updateMany({}, {
                    $set: {
                        score: 0,
                        averageScore: 0,
                        schoolOfTheYearScore: 0,
                        place: null,
                        status: ''
                    }
                });
                console.log("✅ Баллы школ обнулены");
                // Обнуляем баллы районов
                console.log("🏛️ Обнуляем баллы районов...");
                yield district_model_1.default.updateMany({}, {
                    $set: {
                        score: 0,
                        averageScore: 0,
                        rate: 0,
                        districtOfTheYearScore: 0,
                        place: null
                    }
                });
                console.log("✅ Баллы районов обнулены");
                // Месяцы учебного года: сентябрь-декабрь (текущего года), январь-июнь (следующего года)
                const academicMonths = [
                    { month: 9, year: academicYearStart }, // сентябрь
                    { month: 10, year: academicYearStart }, // октябрь
                    { month: 11, year: academicYearStart }, // ноябрь
                    { month: 12, year: academicYearStart }, // декабрь
                    { month: 1, year: academicYearEnd }, // январь
                    { month: 2, year: academicYearEnd }, // февраль
                    { month: 3, year: academicYearEnd }, // март
                    { month: 4, year: academicYearEnd }, // апрель
                    { month: 5, year: academicYearEnd }, // май
                    { month: 6, year: academicYearEnd } // июнь
                ];
                // ============================================================
                // ШАГ 2: ОБРАБОТКА КАЖДОГО МЕСЯЦА УЧЕБНОГО ГОДА
                // ============================================================
                // Обрабатываем каждый месяц учебного года
                for (const monthData of academicMonths) {
                    console.log(`\n${'='.repeat(60)}`);
                    console.log(`📅 Обрабатываем месяц: ${monthData.month}/${monthData.year}`);
                    console.log(`${'='.repeat(60)}`);
                    try {
                        // Проверяем, есть ли результаты за этот месяц
                        const resultsCount = yield studentResult_model_1.default.countDocuments({
                            month: monthData.month,
                            year: monthData.year
                        });
                        if (resultsCount === 0) {
                            console.log(`⚠️ Нет результатов за ${monthData.month}/${monthData.year}, пропускаем...`);
                            continue;
                        }
                        console.log(`📊 Найдено ${resultsCount} результатов за ${monthData.month}/${monthData.year}`);
                        // Вызываем функцию обновления статистики для конкретного месяца
                        yield this.updateStatsForMonth(monthData.month, monthData.year);
                        console.log(`✅ Месяц ${monthData.month}/${monthData.year} обработан успешно`);
                    }
                    catch (error) {
                        console.error(`❌ Ошибка при обработке месяца ${monthData.month}/${monthData.year}:`, error);
                        // Продолжаем обработку других месяцев
                    }
                }
                console.log(`\n${'='.repeat(60)}`);
                console.log("🏁 Обработка всех месяцев завершена");
                console.log(`${'='.repeat(60)}\n`);
                // ============================================================
                // ШАГ 3: ФИНАЛЬНЫЕ ПОДСЧЁТЫ
                // ============================================================
                // После обработки всех месяцев обновляем статистику районов, школ и учителей
                console.log("🔢 Подсчитываем общий score для всех студентов...");
                yield this.updateStudentScores();
                console.log("🏆 Обновляем рейтинг студентов (place)...");
                yield this.updateStudentPlaces();
                console.log("👨‍🏫 Обновляем статистику учителей...");
                yield this.updateTeacherScores();
                yield this.updateTeacherRankings();
                console.log("🏫 Обновляем статистику школ...");
                yield this.updateSchoolScores();
                yield this.updateSchoolRankings();
                console.log("🏛️ Обновляем статистику районов...");
                yield this.updateDistrictScores();
                yield this.updateDistrictRankings();
                console.log("\n✅ Полное обновление статистики за учебный год завершено!");
                return 200;
            }
            catch (error) {
                console.error("❌ Ошибка при полном обновлении статистики:", error);
                throw error;
            }
        });
    }
    /**
     * Обновляет статистику для конкретного месяца
     * Это вспомогательная функция, которая выполняет ту же логику, что и updateStats(),
     * но для указанного месяца, а не текущего
     */
    updateStatsForMonth(month, year) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Шаг 1: Получаем все результаты студентов за указанный месяц
                const studentResults = yield studentResult_model_1.default.find({
                    month: month,
                    year: year
                }).populate({
                    path: 'student',
                    populate: {
                        path: 'district'
                    }
                });
                if (studentResults.length === 0) {
                    console.log(`⚠️ Нет результатов за ${month}/${year}`);
                    return;
                }
                // Шаг 2: Группируем по классам (grade) и районам (district)
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
                // Шаг 3: Находим лучших студентов в каждом классе и районе
                const districtTopStudentUpdates = [];
                for (const [gradeDistrictKey, results] of gradeDistrictGroups.entries()) {
                    const [grade, districtId] = gradeDistrictKey.split('-');
                    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                    if (liceyStudentsWithMaxScore.length > 0) {
                        for (const student of liceyStudentsWithMaxScore) {
                            districtTopStudentUpdates.push({
                                updateOne: {
                                    filter: { _id: student._id },
                                    update: { $set: { studentOfTheMonthScore: 5 } }
                                }
                            });
                        }
                    }
                }
                // Применяем обновления для студентов месяца по районам
                if (districtTopStudentUpdates.length > 0) {
                    yield studentResult_model_1.default.bulkWrite(districtTopStudentUpdates);
                    console.log(`✅ Обновлено ${districtTopStudentUpdates.length} студентов месяца по районам`);
                }
                // Шаг 4: Находим лучших студентов в каждом классе по всей республике
                const republicTopStudentUpdates = [];
                for (const [grade, results] of gradeGroups.entries()) {
                    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                    if (liceyStudentsWithMaxScore.length > 0) {
                        for (const student of liceyStudentsWithMaxScore) {
                            republicTopStudentUpdates.push({
                                updateOne: {
                                    filter: { _id: student._id },
                                    update: { $set: { republicWideStudentOfTheMonthScore: 5 } }
                                }
                            });
                        }
                    }
                }
                // Применяем обновления для студентов месяца по республике
                if (republicTopStudentUpdates.length > 0) {
                    yield studentResult_model_1.default.bulkWrite(republicTopStudentUpdates);
                    console.log(`✅ Обновлено ${republicTopStudentUpdates.length} студентов месяца по республике`);
                }
                // Шаг 5: Находим развивающихся студентов за этот месяц
                yield (0, studentResult_service_1.markDevelopingStudents)(month, year);
            }
            catch (error) {
                console.error(`❌ Ошибка при обновлении статистики для месяца ${month}/${year}:`, error);
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
            // Получаем ВСЕ данные для расчета мест
            const allData = yield teacher_model_1.default
                .find(filter)
                .populate("school")
                .populate({ path: "school", populate: { path: "district", model: "District" } })
                .sort(sortOptions)
                .lean();
            // Расчитываем места по тому же полю, по которому сортируем
            this.assignPlaces(allData, sortColumn);
            // Применяем пагинацию
            const paginatedData = allData.slice(skip, skip + size);
            // Добавляем значения по умолчанию для отсутствующих полей
            paginatedData.forEach(teacher => {
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
                    teacher.place = null;
                }
            });
            const totalCount = yield teacher_model_1.default.countDocuments(filter);
            return { data: paginatedData, totalCount };
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
            // Получаем ВСЕ данные для расчета мест
            const allData = yield school_model_1.default
                .find(filter)
                .populate("district")
                .sort(sortOptions)
                .lean();
            // Расчитываем места по тому же полю, по которому сортируем
            this.assignPlaces(allData, sortColumn);
            // Применяем пагинацию
            const paginatedData = allData.slice(skip, skip + size);
            // Добавляем значения по умолчанию для отсутствующих полей
            paginatedData.forEach(school => {
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
                    school.place = null;
                }
            });
            const totalCount = yield school_model_1.default.countDocuments(filter);
            return { data: paginatedData, totalCount };
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
            // Получаем ВСЕ данные для расчета мест
            const allData = yield district_model_1.default
                .find(filter)
                .sort(sortOptions)
                .lean();
            // Расчитываем места по тому же полю, по которому сортируем
            this.assignPlaces(allData, sortColumn);
            // Применяем пагинацию
            const paginatedData = allData.slice(skip, skip + size);
            // Добавляем значения по умолчанию для отсутствующих полей
            paginatedData.forEach(district => {
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
                    district.place = null;
                }
            });
            const totalCount = yield district_model_1.default.countDocuments(filter);
            return { data: paginatedData, totalCount };
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
    /**
     * Обновляем общий score для всех учителей
     */
    updateTeacherScores() {
        return __awaiter(this, void 0, void 0, function* () {
            // Реализация обновления score для учителей: баллы учителя это сумма баллов его студентов
            try {
                const pipeline = [
                    {
                        $lookup: {
                            from: 'students',
                            localField: '_id',
                            foreignField: 'teacher',
                            as: 'students'
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            totalScore: { $sum: '$students.score' },
                            studentCount: 1 // Используем существующее поле studentCount
                        }
                    },
                    {
                        $addFields: {
                            averageScore: {
                                $cond: {
                                    if: { $gt: ['$studentCount', 0] },
                                    then: { $divide: ['$totalScore', '$studentCount'] },
                                    else: 0
                                }
                            }
                        }
                    }
                ];
                const teacherScores = yield teacher_model_1.default.aggregate(pipeline);
                const bulkOperations = teacherScores.map(teacher => ({
                    updateOne: {
                        filter: { _id: teacher._id },
                        update: {
                            $set: {
                                score: teacher.totalScore,
                                averageScore: teacher.averageScore
                            }
                        }
                    }
                }));
                if (bulkOperations.length > 0) {
                    yield teacher_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} учителей`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении баллов учителей:", error);
                throw error;
            }
        });
    }
    updateTeacherRankings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Получаем всех учителей, отсортированных по score в убывающем порядке
                const teachers = yield teacher_model_1.default.find({ score: { $exists: true } })
                    .sort({ score: -1, code: 1 })
                    .select('_id score');
                if (teachers.length === 0) {
                    console.log("Нет учителей с score для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 1;
                let previousScore = teachers[0].score;
                for (let i = 0; i < teachers.length; i++) {
                    const teacher = teachers[i];
                    // Если балл меньше предыдущего, увеличиваем место
                    if (teacher.score < previousScore) {
                        currentPlace = i + 1;
                    }
                    // Если балл такой же, как у предыдущего, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: teacher._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = teacher.score;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield teacher_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} учителей`);
                    // Показываем статистику рейтинга
                    const topTeacher = teachers[0];
                    const lastTeacher = teachers[teachers.length - 1];
                    console.log(`🥇 Лидер рейтинга учителей: ${topTeacher.score} баллов (место 1)`);
                    console.log(`📊 Всего в рейтинге: ${teachers.length} учителей`);
                    console.log(`🔢 Диапазон баллов: ${lastTeacher.score} - ${topTeacher.score}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении места в рейтинге учителей:", error);
                throw error;
            }
        });
    }
    /**
     * Обновляем общий score для всех школ
     */
    updateSchoolScores() {
        return __awaiter(this, void 0, void 0, function* () {
            // Реализация обновления score для школ: баллы школы это сумма баллов ее учителей
            try {
                const pipeline = [
                    {
                        $group: {
                            _id: "$school",
                            totalScore: { $sum: "$score" }
                        }
                    },
                    {
                        $lookup: {
                            from: 'schools',
                            localField: '_id',
                            foreignField: '_id',
                            as: 'schoolData'
                        }
                    },
                    {
                        $unwind: '$schoolData'
                    },
                    {
                        $addFields: {
                            averageScore: {
                                $cond: {
                                    if: { $gt: ['$schoolData.studentCount', 0] },
                                    then: { $divide: ['$totalScore', '$schoolData.studentCount'] },
                                    else: 0
                                }
                            }
                        }
                    }
                ];
                const schoolScores = yield teacher_model_1.default.aggregate(pipeline).exec();
                const bulkOperations = schoolScores.map(schoolScore => ({
                    updateOne: {
                        filter: { _id: schoolScore._id },
                        update: {
                            $set: {
                                score: schoolScore.totalScore,
                                averageScore: schoolScore.averageScore
                            }
                        }
                    }
                }));
                if (bulkOperations.length > 0) {
                    yield school_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} школ`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении баллов школ:", error);
                throw error;
            }
        });
    }
    updateSchoolRankings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Получаем все школы, отсортированные по score в убывающем порядке
                const schools = yield school_model_1.default.find({ score: { $exists: true } })
                    .sort({ score: -1, code: 1 })
                    .select('_id score');
                if (schools.length === 0) {
                    console.log("Нет школ с score для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 1;
                let previousScore = schools[0].score;
                for (let i = 0; i < schools.length; i++) {
                    const school = schools[i];
                    // Если балл меньше предыдущего, увеличиваем место
                    if (school.score < previousScore) {
                        currentPlace = i + 1;
                    }
                    // Если балл такой же, как у предыдущего, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: school._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = school.score;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield school_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} школ`);
                    // Показываем статистику рейтинга
                    const topSchool = schools[0];
                    const lastSchool = schools[schools.length - 1];
                    console.log(`🥇 Лидер рейтинга школ: ${topSchool.score} баллов (место 1)`);
                    console.log(`📊 Всего в рейтинге: ${schools.length} школ`);
                    console.log(`🔢 Диапазон баллов: ${lastSchool.score} - ${topSchool.score}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении рейтинга школ:", error);
                throw error;
            }
        });
    }
    /**
     * Обновляет общий score для всех районов
     */
    updateDistrictScores() {
        return __awaiter(this, void 0, void 0, function* () {
            // Реализация обновления score для районов: баллы района это сумма баллов его школ
            try {
                const pipeline = [
                    {
                        $lookup: {
                            from: 'students',
                            localField: 'district',
                            foreignField: 'district',
                            as: 'students'
                        }
                    },
                    {
                        $group: {
                            _id: "$district",
                            totalScore: { $sum: "$score" },
                            studentCount: { $sum: { $size: "$students" } }
                        }
                    },
                    {
                        $addFields: {
                            averageScore: {
                                $cond: {
                                    if: { $gt: ['$studentCount', 0] },
                                    then: { $divide: ['$totalScore', '$studentCount'] },
                                    else: 0
                                }
                            }
                        }
                    }
                ];
                const districtScores = yield school_model_1.default.aggregate(pipeline).exec();
                const bulkOperations = districtScores.map(districtScore => ({
                    updateOne: {
                        filter: { _id: districtScore._id },
                        update: {
                            $set: {
                                score: districtScore.totalScore,
                                averageScore: districtScore.averageScore
                            }
                        }
                    }
                }));
                if (bulkOperations.length > 0) {
                    yield district_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} районов`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении баллов районов:", error);
                throw error;
            }
        });
    }
    updateDistrictRankings() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Получаем все районы, отсортированные по score в убывающем порядке
                const districts = yield district_model_1.default.find({ score: { $exists: true } })
                    .sort({ score: -1, code: 1 })
                    .select('_id score');
                if (districts.length === 0) {
                    console.log("Нет районов с score для установки места в рейтинге.");
                    return;
                }
                // Подготавливаем bulk операции для обновления места
                const bulkOperations = [];
                let currentPlace = 1;
                let previousScore = districts[0].score;
                for (let i = 0; i < districts.length; i++) {
                    const district = districts[i];
                    // Если балл меньше предыдущего, увеличиваем место
                    if (district.score < previousScore) {
                        currentPlace = i + 1;
                    }
                    // Если балл такой же, как у предыдущего, место остается тем же
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: district._id },
                            update: { $set: { place: currentPlace } }
                        }
                    });
                    previousScore = district.score;
                }
                // Выполняем массовое обновление мест
                if (bulkOperations.length > 0) {
                    yield district_model_1.default.bulkWrite(bulkOperations);
                    console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} районов`);
                    // Показываем статистику рейтинга
                    const topDistrict = districts[0];
                    const lastDistrict = districts[districts.length - 1];
                    console.log(`🥇 Лидер рейтинга районов: ${topDistrict.score} баллов (место 1)`);
                    console.log(`📊 Всего в рейтинге: ${districts.length} районов`);
                    console.log(`🔢 Диапазон баллов: ${lastDistrict.score} - ${topDistrict.score}`);
                }
            }
            catch (error) {
                console.error("❌ Ошибка при обновлении рейтинга районов:", error);
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
const updateAllStats = () => statsService.updateAllStats();
exports.updateAllStats = updateAllStats;
