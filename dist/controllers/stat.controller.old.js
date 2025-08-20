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
exports.getDistrictStatistics = exports.getSchoolStatistics = exports.getTeacherStatistics = exports.getStatisticsByExam = exports.getStudentsStatistics = exports.updateStatistics = void 0;
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const exam_model_1 = __importDefault(require("../models/exam.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const stats_service_1 = require("../services/stats.service");
const mongoose_1 = require("mongoose");
const updateStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const status = yield (0, stats_service_1.updateStats)();
        if (status === 404) {
            res.status(404).json({ message: "404: Nəticələr tapılmadı!" });
            return;
        }
        res.status(200).json({ message: "Statistika yeniləndi" });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın yenilənməsində xəta!", error });
    }
});
exports.updateStatistics = updateStatistics;
// Ayın şagirdləri, Respublika üzrə ayın şagirdləri və İnkişaf edən şagirdlərin statistikası
const getStudentsStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { month } = req.query;
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const schoolIds = req.query.schoolIds
            ? req.query.schoolIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const teacherIds = req.query.teacherIds
            ? req.query.teacherIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const grades = req.query.grades
            ? req.query.grades.split(',').map(grade => parseInt(grade, 10))
            : [];
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const code = req.query.code ? parseInt(req.query.code) : 0;
        let examIds = req.query.examIds
            ? req.query.examIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        if (!month) {
            res.status(400).json({ message: "Ay seçilməyib!" });
            return;
        }
        const [year, monthStr] = month.split("-");
        const monthIndex = parseInt(monthStr, 10) - 1;
        const selectedMonth = new Date(parseInt(year, 10), monthIndex, 1);
        const startDate = new Date(selectedMonth);
        const endDate = new Date(new Date(startDate).setMonth(startDate.getMonth() + 1));
        if (examIds.length === 0) {
            examIds = yield exam_model_1.default.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
        }
        if (examIds.length === 0) {
            res.status(404).json({ message: "Bu ayda imtahan tapılmadı!" });
            return;
        }
        let codeString = '';
        let codeStringEnd = '';
        if (code) {
            codeString = code.toString().padEnd(10, '0');
            codeStringEnd = code.toString().padEnd(10, '9');
        }
        const pipeline = [
            // 1. Фильтруем результаты по экзаменам месяца
            { $match: { exam: { $in: examIds.map(e => e._id) } } },
            // 2. Присоединяем данные студентов
            {
                $lookup: {
                    from: 'students',
                    localField: 'student',
                    foreignField: '_id',
                    as: 'studentData'
                }
            },
            { $unwind: '$studentData' }, // Разворачиваем массив studentData
            // 3. Присоединяем связанные данные (district, school, teacher)
            {
                $lookup: { from: 'districts', localField: 'studentData.district', foreignField: '_id', as: 'studentData.district' }
            },
            { $unwind: { path: '$studentData.district', preserveNullAndEmptyArrays: true } },
            {
                $lookup: { from: 'schools', localField: 'studentData.school', foreignField: '_id', as: 'studentData.school' }
            },
            { $unwind: { path: '$studentData.school', preserveNullAndEmptyArrays: true } },
            {
                $lookup: { from: 'teachers', localField: 'studentData.teacher', foreignField: '_id', as: 'studentData.teacher' }
            },
            { $unwind: { path: '$studentData.teacher', preserveNullAndEmptyArrays: true } },
            // 4. Применяем фильтры по districtIds, schoolIds, teacherIds
            {
                $match: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (districtIds.length > 0 && { 'studentData.district._id': { $in: districtIds } })), (schoolIds.length > 0 && { 'studentData.school._id': { $in: schoolIds } })), (teacherIds.length > 0 && { 'studentData.teacher._id': { $in: teacherIds } })), (grades.length > 0 && { 'studentData.grade': { $in: grades } })), (code && { 'studentData.code': { $gte: parseInt(codeString), $lte: parseInt(codeStringEnd) } }))
            },
            // 5. Присоединяем данные экзаменов
            {
                $lookup: {
                    from: 'exams',
                    localField: 'exam',
                    foreignField: '_id',
                    as: 'examData'
                }
            },
            { $unwind: '$examData' },
            // 6. Сортируем studentData по sortColumn и sortDirection
            {
                $sort: {
                    [sortColumn]: sortDirection === 'asc' ? 1 : -1, // Сортируем по выбранному столбцу
                    [`studentData.${sortColumn}`]: sortDirection === 'asc' ? 1 : -1,
                }
            },
        ];
        const studentResults = yield studentResult_model_1.default.aggregate(pipeline);
        const studentsOfMonth = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/Ayın şagirdi/i); });
        const studentsOfMonthByRepublic = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/Respublika üzrə ayın şagirdi/i); });
        const developingStudents = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/İnkişaf edən şagird/i); });
        res.status(200).json({ studentsOfMonth, studentsOfMonthByRepublic, developingStudents });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın alınmasında xəta", error });
    }
});
exports.getStudentsStatistics = getStudentsStatistics;
const getStatisticsByExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const examId = req.params.examId;
        const studentResults = yield studentResult_model_1.default.find({ exam: examId })
            .populate("exam")
            .populate({ path: "student", populate: [
                { path: "district", model: "District" },
                { path: "school", model: "School" },
                { path: "teacher", model: "Teacher" }
            ] });
        const studentsOfMonth = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/Ayın şagirdi/i); });
        const studentsOfMonthByRepublic = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/Respublika üzrə ayın şagirdi/i); });
        const developingStudents = studentResults.filter(r => { var _a; return (_a = r.status) === null || _a === void 0 ? void 0 : _a.match(/İnkişaf edən şagird/i); });
        res.status(200).json({ studentsOfMonth, studentsOfMonthByRepublic, developingStudents });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın alınmasında xəta", error });
    }
});
exports.getStatisticsByExam = getStatisticsByExam;
// İlin müəllimləri
const getTeacherStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const schoolIds = req.query.schoolIds
            ? req.query.schoolIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const sortOptions = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        const filter = { score: { $exists: true }, averageScore: { $exists: true } };
        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        if (schoolIds.length > 0) {
            filter.school = { $in: schoolIds };
        }
        // просто берём учителей из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const teachers = yield teacher_model_1.default
            .find(filter)
            .populate("school")
            .populate({ path: "school", populate: { path: "district", model: "District" } })
            .sort(sortOptions);
        res.status(200).json({ teachers });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin statistikasının alınmasında xəta", error });
    }
});
exports.getTeacherStatistics = getTeacherStatistics;
// İlin məktəbləri
const getSchoolStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // просто берём школы из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id))
            : [];
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const sortOptions = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        const filter = { score: { $exists: true }, averageScore: { $exists: true } };
        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        const schools = yield school_model_1.default
            .find(filter)
            .populate("district")
            .sort(sortOptions);
        res.status(200).json({ schools });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Məktəblərin statistikasının alınmasında xəta", error });
    }
});
exports.getSchoolStatistics = getSchoolStatistics;
// İlin rayonları
const getDistrictStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const sortOptions = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        // просто берём районы из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const districts = yield district_model_1.default
            .find({ score: { $exists: true }, averageScore: { $exists: true } })
            .sort(sortOptions);
        res.status(200).json({ districts });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Rayonların statistikasının alınmasında xəta", error });
    }
});
exports.getDistrictStatistics = getDistrictStatistics;
