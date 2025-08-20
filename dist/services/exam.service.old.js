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
exports.getExamsByMonthYear = void 0;
const exam_model_1 = __importDefault(require("../models/exam.model"));
const getExamsByMonthYear = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    // Определяем диапазон дат для поиска экзаменов
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    // Получаем все экзамены за указанный месяц и год
    const exams = yield exam_model_1.default.find({
        date: { $gte: startDate, $lte: endDate }
    });
    return exams;
});
exports.getExamsByMonthYear = getExamsByMonthYear;
