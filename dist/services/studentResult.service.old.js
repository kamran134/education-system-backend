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
exports.deleteStudentResultsByStudents = exports.deleteStudentResultsByStudentId = exports.deleteStudentResultsByExams = exports.deleteStudentResultsByExamId = exports.markAllDevelopingStudents = exports.processStudentResults = exports.markTopStudents = exports.markDevelopingStudents = exports.StudentResultService = void 0;
exports.markTopStudentsRepublic = markTopStudentsRepublic;
const exam_model_1 = __importDefault(require("../models/exam.model"));
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
            const allStudents = existingStudents.concat(newStudentsIds);
            return { students: allStudents, studentsWithoutTeacher };
        });
    }
    markAllDevelopingStudents() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("🔄 Обновление статусов студентов...");
            const studentResultsGrouped = yield this.getStudentResultsGroupedByStudent();
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
    }
    getStudentResultsGroupedByStudent() {
        return __awaiter(this, void 0, void 0, function* () {
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
const markDevelopingStudents = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log(`🔹 Анализируем прогресс студентов до ${month}/${year}...`);
        // 1️⃣ Определяем диапазон дат (до указанного месяца)
        const endDate = new Date(year, month - 1, 31, 23, 59, 59, 999);
        // 2️⃣ Получаем все экзамены до этого месяца
        const exams = yield exam_model_1.default.find({
            date: { $lte: endDate }
        });
        if (!exams.length) {
            console.log("Нет экзаменов за указанный период.");
            return;
        }
        // 3️⃣ Извлекаем ID экзаменов
        const examIds = exams.map(exam => exam._id);
        // 4️⃣ Получаем все результаты по этим экзаменам
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        }).populate("student").populate("exam");
        if (!results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }
        // 5️⃣ Группируем результаты по студентам
        const studentResultsGrouped = results.reduce((acc, result) => {
            const studentId = String(result.student._id);
            if (!acc[studentId]) {
                acc[studentId] = [];
            }
            acc[studentId].push(result);
            return acc;
        }, {});
        const bulkOperations = [];
        // 6️⃣ Анализируем студентов
        for (const studentId in studentResultsGrouped) {
            const studentResults = studentResultsGrouped[studentId];
            // console.log("stud results: ", studentResults);
            // Сортируем экзамены по дате (от старого к новому)
            studentResults.sort((a, b) => a.exam.date.getTime() - b.exam.date.getTime());
            // Обнуляем статус у самого нового результата (текущий месяц)
            //studentResults[studentResults.length - 1].status = "";
            if (studentResults.length <= 1)
                continue; // Пропускаем студентов с 1 экзаменом
            // 7️⃣ Определяем максимальный результат за предыдущие экзамены
            const maxPreviousTotalScore = Math.max(...studentResults.slice(0, -1).map(r => r.totalScore));
            const currentResult = studentResults[studentResults.length - 1];
            // 8️⃣ Проверяем, если текущий результат выше всех предыдущих
            if (currentResult.totalScore > maxPreviousTotalScore) {
                const previousLevel = (0, common_service_1.calculateLevel)(maxPreviousTotalScore);
                const currentLevel = (0, common_service_1.calculateLevel)(currentResult.totalScore);
                if (previousLevel !== currentLevel) {
                    // Добавляем статус и прибавляем 10 очков
                    const updatedStatus = currentResult.status
                        ? `${currentResult.status}, İnkişaf edən şagird`
                        : "İnkişaf edən şagird";
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: currentResult._id },
                            update: { $set: { status: updatedStatus }, $inc: { score: 10 } }
                        }
                    });
                }
            }
        }
        // 9️⃣ Выполняем массовое обновление
        if (bulkOperations.length > 0) {
            yield studentResult_model_1.default.bulkWrite(bulkOperations);
            console.log(`✅ ${bulkOperations.length} nəfər inkişaf edən şagird.`);
        }
        else {
            console.log("Не найдено учеников для обновления.");
        }
    }
    catch (error) {
        console.error("Ошибка в markDevelopingStudents:", error);
    }
});
exports.markDevelopingStudents = markDevelopingStudents;
const markTopStudents = (month, year) => __awaiter(void 0, void 0, void 0, function* () {
    const exams = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
    if (!exams || !exams.length) {
        console.log("Нет экзаменов за этот период.");
        return;
    }
    // Извлекаем ID экзаменов
    const examIds = exams.map(exam => exam._id);
    // Получаем все результаты по найденным экзаменам
    const results = yield studentResult_model_1.default.find({
        exam: { $in: examIds }
    }).populate("student");
    if (!results || !results.length) {
        console.log("Нет результатов экзаменов за этот период.");
        return;
    }
    // Группируем результаты по районам
    const districtGradeGroups = results.reduce((acc, result) => {
        var _a;
        if (!result.student || !result.student.district || result.student.grade === undefined || result.student.grade === null) {
            console.warn("Студент или район не найдены для результата:", result);
            return acc;
        }
        const districtId = (_a = result.student.district) === null || _a === void 0 ? void 0 : _a.toString();
        const grade = result.student.grade;
        const groupKey = `${districtId}-${grade}`;
        if (!acc[groupKey]) {
            acc[groupKey] = [];
        }
        acc[groupKey].push(result);
        return acc;
    }, {});
    // Список обновлений
    const bulkOperations = [];
    for (const groupKey in districtGradeGroups) {
        const groupResults = districtGradeGroups[groupKey];
        // Находим максимальный totalScore в этом районе
        const maxTotalScore = Math.max(...groupResults.map(r => r.totalScore));
        // Если статус не лицейный, то это не успех
        if (maxTotalScore < 47)
            continue;
        // Определяем лучших учеников
        const topStudents = groupResults.filter(r => r.totalScore === maxTotalScore);
        for (const studentResult of topStudents) {
            const updatedStatus = studentResult.status
                ? `${studentResult.status}, Ayın şagirdi`
                : "Ayın şagirdi";
            bulkOperations.push({
                updateOne: {
                    filter: { _id: studentResult._id },
                    update: { $set: { status: updatedStatus }, $inc: { score: 5 } }
                }
            });
        }
    }
    // Выполняем массовое обновление
    if (bulkOperations.length > 0) {
        yield studentResult_model_1.default.bulkWrite(bulkOperations);
        console.log(`${bulkOperations.length} nəfər ayın şagirdi tapıldı.`);
    }
    else {
        console.log("Не найдено учеников для обновления.");
    }
});
exports.markTopStudents = markTopStudents;
function markTopStudentsRepublic(month, year) {
    return __awaiter(this, void 0, void 0, function* () {
        const exams = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
        if (!exams || !exams.length) {
            console.log("Нет экзаменов за этот период.");
            return;
        }
        // Извлекаем ID экзаменов
        const examIds = exams.map(exam => exam._id);
        // Получаем все результаты по найденным экзаменам
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        });
        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }
        // Группируем результаты по классам
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
        const bulkOperations = [];
        // Проходим по каждому классу и находим лучших учеников
        for (const grade in gradeGroups) {
            const gradeResults = gradeGroups[grade];
            // Находим максимальный totalScore по всей республике
            const maxTotalScore = Math.max(...gradeResults.map(r => r.totalScore));
            if (maxTotalScore < 47)
                continue; // Если максимальный балл меньше 47, то не считаем
            // Если статус не лицейный, то это не успех
            // Определяем лучших учеников
            const topStudents = gradeResults.filter(r => r.totalScore === maxTotalScore);
            for (const studentResult of topStudents) {
                const updatedStatus = studentResult.status
                    ? `${studentResult.status}, Respublika üzrə ayın şagirdi`
                    : "Respublika üzrə ayın şagirdi";
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: studentResult._id },
                        update: { $set: { status: updatedStatus }, $inc: { score: 5 } }
                    }
                });
            }
        }
        // Выполняем массовое обновление
        if (bulkOperations.length > 0) {
            const result = yield studentResult_model_1.default.bulkWrite(bulkOperations);
            console.log(`Обновлено ${result.modifiedCount} записей.`);
        }
        else {
            console.log("Не найдено учеников для обновления.");
        }
    });
}
function getStudentResultsGroupedByStudent() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield studentResult_model_1.default.aggregate([
            {
                $lookup: {
                    from: "students",
                    localField: "student",
                    foreignField: "_id",
                    as: "student"
                }
            },
            { $unwind: "$student" },
            {
                $lookup: {
                    from: "exams",
                    localField: "exam",
                    foreignField: "_id",
                    as: "exam"
                }
            },
            { $unwind: "$exam" },
            { $sort: { "exam.date": 1 } },
            {
                $group: {
                    _id: "$student._id",
                    student: { $first: "$student" },
                    results: {
                        $push: {
                            _id: "$_id",
                            exam: "$exam",
                            grade: "$grade",
                            disciplines: "$disciplines",
                            totalScore: "$totalScore",
                            score: "$score",
                            level: "$level",
                            status: "$status"
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    student: 1,
                    results: 1
                }
            }
        ]);
    });
}
// Legacy functions for backward compatibility
const studentResultService = new StudentResultService();
const processStudentResults = (studentDataToInsert) => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResultService.processStudentResults(studentDataToInsert);
});
exports.processStudentResults = processStudentResults;
const markAllDevelopingStudents = () => __awaiter(void 0, void 0, void 0, function* () {
    return yield studentResultService.markAllDevelopingStudents();
});
exports.markAllDevelopingStudents = markAllDevelopingStudents;
const deleteStudentResultsByExamId = (examId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield studentResult_model_1.default.deleteMany({ exam: examId });
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentResultsByExamId = deleteStudentResultsByExamId;
const deleteStudentResultsByExams = (examIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield studentResult_model_1.default.deleteMany({ exam: { $in: examIds } });
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentResultsByExams = deleteStudentResultsByExams;
const deleteStudentResultsByStudentId = (studentId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield studentResult_model_1.default.deleteMany({ student: studentId });
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentResultsByStudentId = deleteStudentResultsByStudentId;
const deleteStudentResultsByStudents = (studentIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentResultsByStudents = deleteStudentResultsByStudents;
