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
exports.deleteExam = exports.deleteAllExams = exports.createExam = exports.getExamsForFilter = exports.getExams = void 0;
const exam_model_1 = __importDefault(require("../models/exam.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const studentResult_service_1 = require("../services/studentResult.service");
const getExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (page - 1) * size;
        const [data, totalCount] = yield Promise.all([
            exam_model_1.default.find()
                .sort({ date: 1 })
                .skip(skip)
                .limit(size),
            exam_model_1.default.countDocuments()
        ]);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "İmtahanların alınmasında xəta", error });
    }
});
exports.getExams = getExams;
const getExamsForFilter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exams = yield exam_model_1.default.find().sort({ date: -1 });
        res.status(200).json({ data: exams });
    }
    catch (error) {
        res.status(500).json({ message: "İmtahanların alınmasında xəta", error });
    }
});
exports.getExamsForFilter = getExamsForFilter;
const createExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, code, date } = req.body;
        const existingExam = yield exam_model_1.default.findOne({ code, date });
        if (existingExam) {
            res.status(400).json({ message: "Bu kodda və tarixdə imtahan artıq mövcuddur!" });
            return;
        }
        const exam = new exam_model_1.default({ name, code, date });
        const savedExam = yield exam.save();
        res.status(201).json(savedExam);
    }
    catch (error) {
        res.status(500).json({ message: "İmtahanın yaradılmasında xəta!", error });
    }
});
exports.createExam = createExam;
const deleteAllExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield studentResult_model_1.default.deleteMany();
        const result = yield exam_model_1.default.deleteMany();
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
exports.deleteAllExams = deleteAllExams;
const deleteExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const examId = req.params.id;
        yield (0, studentResult_service_1.deleteStudentResultsByExamId)(examId);
        const result = yield exam_model_1.default.findByIdAndDelete(req.params.id);
        if (!result) {
            res.status(404).json({ message: "İmtahan tapılmadı" });
        }
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
exports.deleteExam = deleteExam;
