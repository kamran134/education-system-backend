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
exports.markTopStudentsRepublic = exports.markTopStudents = exports.markDevelopingStudents = exports.getStudentResultsGroupedByStudent = exports.markAllDevelopingStudents = exports.deleteStudentResultsByStudents = exports.deleteStudentResultsByExams = exports.deleteStudentResultsByStudentId = exports.deleteStudentResultsByExamId = exports.processStudentResults = exports.StudentResultService = void 0;
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const common_service_1 = require("./common.service");
const exam_service_1 = require("./exam.service");
const student_service_1 = require("./student.service");
class StudentResultService {
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.findById(id)
                .populate('student')
                .populate('exam');
        });
    }
    getResultsByStudentId(studentId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.find({ student: studentId }).populate('exam');
        });
    }
    getResultsByExamId(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.find({ exam: examId })
                .populate('student')
                .populate('exam');
        });
    }
    create(resultData) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = new studentResult_model_1.default(resultData);
            return yield result.save();
        });
    }
    createBulk(resultsData) {
        return __awaiter(this, void 0, void 0, function* () {
            const bulkOps = resultsData.map(result => ({
                updateOne: {
                    filter: { student: result.student, exam: result.exam },
                    update: { $set: result },
                    upsert: true
                }
            }));
            const result = yield studentResult_model_1.default.bulkWrite(bulkOps);
            return {
                insertedCount: result.upsertedCount || 0,
                modifiedCount: result.modifiedCount || 0,
                deletedCount: 0,
                errors: []
            };
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedResult = yield studentResult_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate('student exam');
            if (!updatedResult) {
                throw new Error('Student result not found');
            }
            return updatedResult;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield studentResult_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('Student result not found');
            }
        });
    }
    deleteByStudentId(studentId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.deleteMany({ student: studentId });
        });
    }
    deleteBulkByStudentIds(studentIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        });
    }
    deleteByExamId(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield studentResult_model_1.default.deleteMany({ exam: examId });
        });
    }
    getFilteredResults(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                studentResult_model_1.default.find(filter)
                    .populate('student exam')
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                studentResult_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    processStudentResults(studentDataToInsert) {
        return __awaiter(this, void 0, void 0, function* () {
            const studentCodes = studentDataToInsert.map(item => item.code);
            const existingStudents = yield student_model_1.default.find({ code: { $in: studentCodes } });
            const newStudents = studentDataToInsert.filter(student => !existingStudents.map(d => d.code).includes(student.code));
            // Assign teacher to student
            yield Promise.all(newStudents.map((student) => __awaiter(this, void 0, void 0, function* () {
                yield (0, student_service_1.assignTeacherToStudent)(student);
            })));
            const studentsWithTeacher = newStudents.filter(student => student.teacher);
            const studentsWithoutTeacher = newStudents
                .filter(student => !student.teacher)
                .map(student => student.code);
            const newStudentsDocs = yield student_model_1.default.insertMany(studentsWithTeacher);
            const newStudentsIds = newStudentsDocs.map(doc => doc.toObject());
            const allStudents = [...existingStudents, ...newStudentsIds];
            return { students: allStudents, studentsWithoutTeacher };
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.examIds && filters.examIds.length > 0) {
            filter.exam = { $in: filters.examIds };
        }
        return filter;
    }
}
exports.StudentResultService = StudentResultService;
// Legacy functions for backward compatibility
const studentResultService = new StudentResultService();
const processStudentResults = (studentDataToInsert) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResultService.processStudentResults(studentDataToInsert);
});
exports.processStudentResults = processStudentResults;
const deleteStudentResultsByExamId = (examId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResult_model_1.default.deleteMany({ exam: examId });
});
exports.deleteStudentResultsByExamId = deleteStudentResultsByExamId;
const deleteStudentResultsByStudentId = (studentId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResult_model_1.default.deleteMany({ student: studentId });
});
exports.deleteStudentResultsByStudentId = deleteStudentResultsByStudentId;
const deleteStudentResultsByExams = (examIds) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResult_model_1.default.deleteMany({ exam: { $in: examIds } });
});
exports.deleteStudentResultsByExams = deleteStudentResultsByExams;
const deleteStudentResultsByStudents = (studentIds) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
});
exports.deleteStudentResultsByStudents = deleteStudentResultsByStudents;
// Additional legacy functions that may be used elsewhere
const markAllDevelopingStudents = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("🔄 Обновление статусов студентов...");
    const studentResultsGrouped = yield (0, exports.getStudentResultsGroupedByStudent)();
    if (studentResultsGrouped.length === 0)
        return;
    const bulkOperations = [];
    console.log("Найдено ", studentResultsGrouped.length, " студентов с результатами экзаменов.");
    for (const student of studentResultsGrouped) {
        if (student.results.length <= 1)
            continue;
        // Reset status for newest result
        student.results[0].status = "";
        student.results[0].score = 1;
        let maxTotalScore = student.results[0].totalScore;
        let maxLevel = (0, common_service_1.calculateLevelNumb)(maxTotalScore);
        for (let i = 1; i < student.results.length; i++) {
            const currentResult = student.results[i];
            currentResult.status = "";
            currentResult.score = 1;
            if ((0, common_service_1.calculateLevelNumb)(currentResult.totalScore) > maxLevel) {
                currentResult.status = "İnkişaf edən şagird";
                currentResult.score += 10;
                maxLevel = (0, common_service_1.calculateLevelNumb)(currentResult.totalScore);
                maxTotalScore = currentResult.totalScore;
            }
            bulkOperations.push({
                updateOne: {
                    filter: { _id: currentResult._id },
                    update: { $set: { status: currentResult.status, score: currentResult.score } }
                }
            });
        }
    }
    if (bulkOperations.length > 0) {
        yield studentResult_model_1.default.bulkWrite(bulkOperations);
        console.log(`✅ Обновлено ${bulkOperations.length} статусов студентов.`);
    }
    else {
        console.log("Не найдено студентов для обновления.");
    }
    console.log("✅ Статусы студентов обновлены.");
});
exports.markAllDevelopingStudents = markAllDevelopingStudents;
const getStudentResultsGroupedByStudent = () => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResult_model_1.default.aggregate([
        {
            $lookup: {
                from: 'exams',
                localField: 'exam',
                foreignField: '_id',
                as: 'examData'
            }
        },
        { $unwind: '$examData' },
        {
            $sort: {
                student: 1,
                'examData.date': -1
            }
        },
        {
            $group: {
                _id: '$student',
                results: { $push: '$$ROOT' }
            }
        }
    ]);
});
exports.getStudentResultsGroupedByStudent = getStudentResultsGroupedByStudent;
const markDevelopingStudents = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bulkOperations = [];
        console.log(`🔄 Поиск развивающихся студентов за ${month}/${year}...`);
        const examIds = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }
        console.log(`Найдено экзаменов: ${examIds.length}`);
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        });
        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }
        const gradeGroups = results.reduce((acc, result) => {
            const grade = result.grade;
            if (grade === undefined || grade === null) {
                console.warn("Класс не найден для результата:", result);
                return acc;
            }
            if (!acc[grade]) {
                acc[grade] = [];
            }
            acc[grade].push(result);
            return acc;
        }, {});
        for (const [gradeKey, gradeResults] of Object.entries(gradeGroups)) {
            const grade = parseInt(gradeKey);
            console.log(`Обработка класса ${grade}: ${gradeResults.length} результатов`);
            for (const currentResult of gradeResults) {
                if (!currentResult.student || typeof currentResult.student === 'string') {
                    console.warn("Student ID отсутствует или является строкой:", currentResult);
                    continue;
                }
                const currentLevel = (0, common_service_1.calculateLevelNumb)(currentResult.totalScore);
                const previousResults = yield studentResult_model_1.default.find({
                    student: currentResult.student,
                    exam: { $nin: examIds }
                }).populate('exam');
                if (!previousResults.length) {
                    continue;
                }
                let maxPreviousLevel = 0;
                for (const prevResult of previousResults) {
                    const prevLevel = (0, common_service_1.calculateLevelNumb)(prevResult.totalScore);
                    if (prevLevel > maxPreviousLevel) {
                        maxPreviousLevel = prevLevel;
                    }
                }
                if (currentLevel > maxPreviousLevel) {
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: currentResult._id },
                            update: {
                                $set: {
                                    status: "İnkişaf edən şagird",
                                    score: currentResult.score + 10
                                }
                            }
                        }
                    });
                }
            }
        }
        if (bulkOperations.length > 0) {
            yield studentResult_model_1.default.bulkWrite(bulkOperations);
            console.log(`✅ Найдено и обновлено ${bulkOperations.length} развивающихся студентов за ${month}/${year}.`);
        }
        else {
            console.log(`Не найдено развивающихся студентов за ${month}/${year}.`);
        }
    }
    catch (error) {
        console.error("Ошибка в markDevelopingStudents:", error);
    }
});
exports.markDevelopingStudents = markDevelopingStudents;
const markTopStudents = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bulkOperations = [];
        console.log(`🔄 Определение лучших студентов месяца за ${month}/${year}...`);
        const examIds = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }
        console.log(`Найдено экзаменов: ${examIds.length}`);
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        });
        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }
        const gradeGroups = results.reduce((acc, result) => {
            const grade = result.grade;
            if (grade === undefined || grade === null) {
                console.warn("Класс не найден для результата:", result);
                return acc;
            }
            if (!acc[grade]) {
                acc[grade] = [];
            }
            acc[grade].push(result);
            return acc;
        }, {});
        for (const [gradeKey, gradeResults] of Object.entries(gradeGroups)) {
            const grade = parseInt(gradeKey);
            console.log(`Обработка класса ${grade}: ${gradeResults.length} результатов`);
            gradeResults.sort((a, b) => b.totalScore - a.totalScore);
            if (gradeResults.length > 0) {
                const topResult = gradeResults[0];
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: topResult._id },
                        update: {
                            $set: {
                                status: topResult.status ? `${topResult.status}, Ayın şagirdi` : "Ayın şagirdi",
                                score: topResult.score + 25
                            }
                        }
                    }
                });
            }
        }
        if (bulkOperations.length > 0) {
            yield studentResult_model_1.default.bulkWrite(bulkOperations);
            console.log(`✅ Определено и обновлено ${bulkOperations.length} лучших студентов месяца за ${month}/${year}.`);
        }
        else {
            console.log(`Не найдено лучших студентов месяца за ${month}/${year}.`);
        }
    }
    catch (error) {
        console.error("Ошибка в markTopStudents:", error);
    }
});
exports.markTopStudents = markTopStudents;
const markTopStudentsRepublic = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bulkOperations = [];
        console.log(`🔄 Определение лучших студентов республики за ${month}/${year}...`);
        const examIds = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }
        console.log(`Найдено экзаменов: ${examIds.length}`);
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        });
        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }
        const gradeGroups = results.reduce((acc, result) => {
            const grade = result.grade;
            if (grade === undefined || grade === null) {
                console.warn("Класс не найден для результата:", result);
                return acc;
            }
            if (!acc[grade]) {
                acc[grade] = [];
            }
            acc[grade].push(result);
            return acc;
        }, {});
        for (const [gradeKey, gradeResults] of Object.entries(gradeGroups)) {
            const grade = parseInt(gradeKey);
            console.log(`Обработка класса ${grade}: ${gradeResults.length} результатов`);
            gradeResults.sort((a, b) => b.totalScore - a.totalScore);
            if (gradeResults.length > 0) {
                const topResult = gradeResults[0];
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: topResult._id },
                        update: {
                            $set: {
                                status: topResult.status
                                    ? `${topResult.status}, Respublika üzrə ayın şagirdi`
                                    : "Respublika üzrə ayın şagirdi",
                                score: topResult.score + 100
                            }
                        }
                    }
                });
            }
        }
        if (bulkOperations.length > 0) {
            yield studentResult_model_1.default.bulkWrite(bulkOperations);
            console.log(`✅ Определено и обновлено ${bulkOperations.length} лучших студентов республики за ${month}/${year}.`);
        }
        else {
            console.log(`Не найдено лучших студентов республики за ${month}/${year}.`);
        }
    }
    catch (error) {
        console.error("Ошибка в markTopStudentsRepublic:", error);
    }
});
exports.markTopStudentsRepublic = markTopStudentsRepublic;
