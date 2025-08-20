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
exports.deleteResults = exports.createAllResults = exports.getStudentResults = void 0;
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const mongoose_1 = require("mongoose");
const file_service_1 = require("../services/file.service");
const studentResult_service_1 = require("../services/studentResult.service");
const excel_service_1 = require("../services/excel.service");
const getStudentResults = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = yield studentResult_model_1.default.find().populate("student").populate("exam");
        res.status(200).json(results);
    }
    catch (error) {
        res.status(500).json({ message: "Şagird nəticələri tapılmadı!", error });
    }
});
exports.getStudentResults = getStudentResults;
const createAllResults = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "Fayl yüklənməyib!" });
            return;
        }
        const { examId } = req.body;
        if (!examId) {
            res.status(400).json({ message: "İmtahan seçilməyib!" });
            return;
        }
        const rows = (0, excel_service_1.readExcel)(req.file.path);
        if (rows.length < 2) {
            res.status(400).json({ message: "Faylda kifayət qədər sətr yoxdur!" });
            return;
        }
        const resultReadedData = rows.slice(3).map(row => ({
            examId: examId,
            grade: Number(row[2]),
            studentCode: Number(row[3]),
            lastName: String(row[4]),
            firstName: String(row[5]),
            middleName: String(row[6]),
            az: Number(row[7]),
            math: Number(row[8]),
            lifeKnowledge: Number(row[2]) === 5 ? 0 : Number(row[9]),
            logic: Number(row[2]) === 5 ? Number(row[9]) : Number(row[10]),
            totalScore: Number(row[2]) === 5 ? Number(row[10]) : Number(row[11]),
            level: Number(row[2]) === 5 ? String(row[11]) : String(row[12])
        }));
        const studentDataToInsert = rows.slice(3).map(row => ({
            code: Number(row[3]),
            lastName: String(row[4]),
            firstName: String(row[5]),
            middleName: String(row[6]),
            grade: Number(row[2]),
        }));
        const correctStudentDataToInsert = studentDataToInsert.filter(data => data.code > 999999999);
        const incorrectStudentCodes = studentDataToInsert.filter(data => data.code <= 999999999).map(data => data.code);
        const { students, studentsWithoutTeacher } = yield (0, studentResult_service_1.processStudentResults)(correctStudentDataToInsert);
        // нужны только те студенты, которые есть в базе и те, у кого totalScore = az + math + lifeKnowledge + logic
        const filtredResults = resultReadedData.filter(result => students.map(student => student.code).includes(result.studentCode)
            && result.totalScore === (result.az + result.math + result.lifeKnowledge + result.logic)
            && result.totalScore > 0);
        const studentsWithIncorrectResults = resultReadedData.filter(result => students.map(student => student.code).includes(result.studentCode)
            && result.totalScore !== (result.az + result.math + result.lifeKnowledge + result.logic)
            && result.totalScore > 0);
        const resultsToInsert = filtredResults.map(result => ({
            student: students.find(student => student.code === result.studentCode)._id,
            exam: result.examId,
            grade: result.grade,
            disciplines: {
                az: Number(result.az) || 0,
                math: Number(result.math) || 0,
                lifeKnowledge: Number(result.lifeKnowledge) || 0,
                logic: Number(result.logic) || 0
            },
            totalScore: result.totalScore,
            level: result.level,
            score: 1
        }));
        // Remove the uploaded file
        (0, file_service_1.deleteFile)(req.file.path);
        // const results = await StudentResult.insertMany(resultsToInsert);
        const bulkOps = resultsToInsert.map(result => ({
            updateOne: {
                filter: { student: result.student, exam: result.exam },
                update: { $set: result },
                upsert: true // Если записи нет – создаст новую
            }
        }));
        const results = yield studentResult_model_1.default.bulkWrite(bulkOps);
        res.status(201).json({
            message: "Şagirdin nəticələri uğurla yaradıldı!",
            results,
            studentsWithoutTeacher,
            incorrectStudentCodes,
            studentsWithIncorrectResults
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Şagirdlərin nəticələrinin yaradılmasında xəta!", error });
    }
});
exports.createAllResults = createAllResults;
const deleteResults = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId } = req.params;
        if (!examId) {
            res.status(400).json({ message: "İmtahan seçilməyib!" });
        }
        const objectId = new mongoose_1.Types.ObjectId(examId);
        // Шаг 1: Найти всех студентов, у которых есть результаты по этому экзамену
        const studentResults = yield studentResult_model_1.default.find({ exam: objectId }).select("student");
        const studentIds = studentResults.map(result => result.student);
        // Шаг 2: Удалить результаты экзамена
        const deletedResults = yield studentResult_model_1.default.deleteMany({ exam: objectId });
        if (deletedResults.deletedCount === 0) {
            res.status(404).json({ message: "Bu imtahan üçün nəticələr tapılmadı!" });
        }
        // Шаг 3: Очистить поле `status` у найденных студентов
        if (studentIds.length > 0) {
            yield student_model_1.default.updateMany({ _id: { $in: studentIds } }, // Найти всех студентов по их _id
            { $unset: { status: "" } } // Удалить поле `status`
            );
        }
        res.status(200).json({
            message: "İmtahan nəticələri uğurla silindi!",
            totalCount: deletedResults.deletedCount
        });
    }
    catch (error) {
        res.status(500).json({ message: "İmtahan nəticələrini silərkən xəta baş verdi!", error });
    }
});
exports.deleteResults = deleteResults;
