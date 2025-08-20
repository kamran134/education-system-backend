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
exports.calculateAndSaveScores = exports.updateStats = exports.resetStats = void 0;
const exam_model_1 = __importDefault(require("../models/exam.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const studentResult_service_1 = require("./studentResult.service");
const district_service_1 = require("./district.service");
const resetStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("🔄 Сброс статистики...");
        yield district_model_1.default.updateMany({}, { score: 0, averageScore: 0, rate: 0 });
        yield studentResult_model_1.default.updateMany({}, { status: "", score: 1 });
        console.log("✅ Статистика сброшена.");
    }
    catch (error) {
        console.error(error);
    }
});
exports.resetStats = resetStats;
const updateStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Сначала сбрасываем всю статистику
        yield (0, exports.resetStats)();
        yield (0, district_service_1.countDistrictsRates)();
        // Получаем все даты экзаменов (только поле date)
        const exams = yield exam_model_1.default.find({}, { date: 1 });
        if (!exams.length) {
            console.log("Нет экзаменов в базе.");
            return 404;
        }
        // Создаём Set для хранения уникальных (год, месяц)
        const uniqueMonths = new Set();
        for (const exam of exams) {
            const date = new Date(exam.date);
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // Январь — 1, Февраль — 2 и т. д.
            uniqueMonths.add(`${year}-${month}`);
        }
        // Преобразуем в массив и сортируем по дате (по возрастанию)
        const sortedMonths = Array.from(uniqueMonths)
            .map(m => {
            const [year, month] = m.split("-").map(Number);
            return { year, month };
        })
            .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
        console.log(`Будет обработано ${sortedMonths.length} месяцев...`);
        // await markDevelopingStudents(new Date().getMonth(), new Date().getFullYear());
        yield (0, studentResult_service_1.markAllDevelopingStudents)();
        // Вызываем `markTopStudents()` для каждого месяца
        for (const { year, month } of sortedMonths) {
            console.log(`🔹 Обрабатываем ${month}/${year}...`);
            //await markDevelopingStudents(month, year);
            yield (0, studentResult_service_1.markTopStudents)(month, year);
            yield (0, studentResult_service_1.markTopStudentsRepublic)(month, year);
        }
        console.log("✅ Обработка всех месяцев завершена.");
        yield (0, exports.calculateAndSaveScores)();
        return 200;
    }
    catch (error) {
        throw error;
    }
});
exports.updateStats = updateStats;
const calculateAndSaveScores = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("🔄 Обновление баллов...");
        // Загружаем результаты вместе со студентами, их школами, районами и учителями
        const results = yield studentResult_model_1.default.find().populate({
            path: 'student',
            populate: [
                { path: 'district' },
                { path: 'school', populate: { path: 'district' } },
                { path: 'teacher', populate: { path: 'school' } }
            ]
        });
        // Создаём мапы для хранения сумм баллов
        const districtScores = new Map();
        const schoolScores = new Map();
        const teacherScores = new Map();
        const studentScores = new Map();
        for (const result of results) {
            const student = result.student;
            if (!student)
                continue;
            const { district, school, teacher } = student;
            const score = result.score;
            if (district && '_id' in district) {
                const districtId = district._id.toString();
                districtScores.set(districtId, (districtScores.get(districtId) || 0) + score);
            }
            if (school && '_id' in school) {
                const schoolId = school._id.toString();
                schoolScores.set(schoolId, (schoolScores.get(schoolId) || 0) + score);
            }
            if (teacher && '_id' in teacher) {
                const teacherId = teacher._id.toString();
                teacherScores.set(teacherId, (teacherScores.get(teacherId) || 0) + score);
            }
            const studentId = student._id.toString();
            studentScores.set(studentId, (studentScores.get(studentId) || 0) + score);
        }
        console.log("🔄 Обновление среднего балла районов, школ и учителей...");
        // Загружаем районы с их rate
        const districts = yield district_model_1.default.find();
        const districtRates = new Map(districts.map(d => [d._id.toString(), d.rate || 1]));
        // Обновляем данные в базе
        // Обновляем баллы для районов
        Promise.all([
            updateDistrictScores(districtRates, districtScores),
            updateSchoolScores(districtRates, schoolScores, results),
            updateTeacherScores(districtRates, teacherScores, results),
            updateStudentScores(districtRates, studentScores, results)
        ]);
        console.log("✅ Баллы обновлены.");
    }
    catch (error) {
        console.error('Error updating scores:', error);
    }
});
exports.calculateAndSaveScores = calculateAndSaveScores;
const updateDistrictScores = (districtRates, districtScores) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("🔄 Обновление баллов районов...");
        // Обновляем баллы для районов
        for (const [districtId, score] of districtScores.entries()) {
            const rate = districtRates.get(districtId) || 1;
            yield district_model_1.default.findByIdAndUpdate(districtId, {
                score,
                averageScore: score / rate
            });
        }
    }
    catch (error) {
        console.error('Error updating district scores:', error);
    }
});
const updateSchoolScores = (districtRates, schoolScores, results) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log("🔄 Обновление баллов школ...");
        // Обновляем баллы для школ
        for (const [schoolId, score] of schoolScores.entries()) {
            const school = (_a = results.find(r => { var _a; return (((_a = r.student.school) === null || _a === void 0 ? void 0 : _a._id) || '').toString() === schoolId; })) === null || _a === void 0 ? void 0 : _a.student.school;
            const districtId = (((_b = school === null || school === void 0 ? void 0 : school.district) === null || _b === void 0 ? void 0 : _b._id) || '').toString();
            const rate = districtRates.get(districtId || '') || 1;
            yield school_model_1.default.findByIdAndUpdate(schoolId, {
                score,
                averageScore: score / rate
            });
        }
    }
    catch (error) {
        console.error('Error updating school scores:', error);
    }
});
const updateTeacherScores = (districtRates, teacherScores, results) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log("🔄 Обновление баллов учителей...");
        // Обновляем баллы для учителей
        for (const [teacherId, score] of teacherScores.entries()) {
            const teacher = (_a = results.find(r => { var _a; return (((_a = r.student.teacher) === null || _a === void 0 ? void 0 : _a._id) || '').toString() === teacherId; })) === null || _a === void 0 ? void 0 : _a.student.teacher;
            const districtId = (_b = teacher === null || teacher === void 0 ? void 0 : teacher.school) === null || _b === void 0 ? void 0 : _b.district.toString();
            const rate = districtRates.get(districtId || '') || 1;
            yield teacher_model_1.default.findByIdAndUpdate(teacherId, {
                score,
                averageScore: score / rate
            });
        }
    }
    catch (error) {
        console.error('Error updating teacher scores:', error);
    }
});
const updateStudentScores = (districtRates, studentScores, results) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log("🔄 Обновление баллов студентов...");
        // Обновляем баллы для студентов
        for (const [studentId, score] of studentScores.entries()) {
            const student = (_a = results.find(r => (r.student._id || '').toString() === studentId)) === null || _a === void 0 ? void 0 : _a.student;
            const districtId = (((_b = student === null || student === void 0 ? void 0 : student.district) === null || _b === void 0 ? void 0 : _b._id) || '').toString();
            const rate = districtRates.get(districtId || '') || 1;
            yield student_model_1.default.findByIdAndUpdate(studentId, {
                score,
                averageScore: score / rate
            });
        }
    }
    catch (error) {
        console.error('Error updating student scores:', error);
    }
});
