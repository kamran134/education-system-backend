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
exports.deleteResultsByExamId = exports.processStudentResultsFromExcel = exports.markTopStudentsRepublic = exports.markTopStudents = exports.markDevelopingStudents = exports.getStudentResultsGroupedByStudent = exports.markAllDevelopingStudents = exports.deleteStudentResultsByStudents = exports.deleteStudentResultsByExams = exports.deleteStudentResultsByStudentId = exports.deleteStudentResultsByExamId = exports.processStudentResults = exports.StudentResultService = void 0;
const mongoose_1 = require("mongoose");
const exam_model_1 = __importDefault(require("../models/exam.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const common_service_1 = require("./common.service");
const exam_service_1 = require("./exam.service");
const student_service_1 = require("./student.service");
const excel_service_1 = require("./excel.service");
const file_service_1 = require("./file.service");
const participation_types_1 = require("../types/participation.types");
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
        const exams = yield (0, exam_service_1.getExamsByMonthYear)(month, year);
        if (!exams.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }
        const examIds = exams.map(e => e._id);
        console.log(`Найдено экзаменов: ${examIds.length}`);
        const results = yield studentResult_model_1.default.find({
            exam: { $in: examIds }
        }).populate('exam');
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
                if (!currentResult.exam || typeof currentResult.exam === 'string') {
                    console.warn("Exam не найден для результата:", currentResult);
                    continue;
                }
                const currentLevel = (0, common_service_1.calculateLevelNumb)(currentResult.totalScore);
                const currentExamDate = new Date(currentResult.exam.date);
                // Получаем ВСЕ результаты студента
                const allStudentResults = yield studentResult_model_1.default.find({
                    student: currentResult.student
                }).populate('exam');
                // Фильтруем только те результаты, которые РАНЬШЕ текущего экзамена по дате
                const olderResults = allStudentResults.filter(prevResult => {
                    if (!prevResult.exam || typeof prevResult.exam === 'string')
                        return false;
                    const prevExamDate = new Date(prevResult.exam.date);
                    return prevExamDate < currentExamDate;
                });
                console.log(`📊 Студент ${currentResult.student}: текущий экзамен ${currentExamDate.toISOString()}, всего результатов: ${allStudentResults.length}, предыдущих: ${olderResults.length}`);
                if (!olderResults.length) {
                    // Это первый экзамен студента - пропускаем
                    console.log(`   ⏭️  Первый экзамен студента - пропускаем`);
                    continue;
                }
                let maxPreviousLevel = 0;
                for (const prevResult of olderResults) {
                    const prevLevel = (0, common_service_1.calculateLevelNumb)(prevResult.totalScore);
                    if (prevLevel > maxPreviousLevel) {
                        maxPreviousLevel = prevLevel;
                    }
                }
                console.log(`   📈 Текущий уровень: ${currentLevel}, максимальный предыдущий: ${maxPreviousLevel}`);
                if (currentLevel > maxPreviousLevel) {
                    console.log(`   ✅ РАЗВИТИЕ! Добавляем статус и +10 баллов`);
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: currentResult._id },
                            update: {
                                $set: {
                                    status: "İnkişaf edən şagird",
                                    developmentScore: 10
                                }
                            }
                        }
                    });
                }
                else {
                    console.log(`   ⏭️  Уровень не повысился - пропускаем`);
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
const processStudentResultsFromExcel = (filePath, examId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = (0, excel_service_1.readExcel)(filePath);
        if (rows.length < 2) {
            throw new Error("Faylda kifayət qədər sətr yoxdur!");
        }
        // Get exam data to extract month and year
        const exam = yield exam_model_1.default.findById(examId);
        if (!exam) {
            throw new Error("İmtahan tapılmadı!");
        }
        const examDate = new Date(exam.date);
        const month = examDate.getMonth() + 1; // JavaScript months are 0-indexed
        const year = examDate.getFullYear();
        const resultReadedData = rows.slice(3).map(row => ({
            examId: new mongoose_1.Types.ObjectId(examId),
            grade: Number(row[2]),
            studentCode: Number(row[3]),
            lastName: String(row[4]),
            firstName: String(row[5]),
            middleName: String(row[6]),
            az: Number(row[2]) >= 5 ? Number(row[8]) : Number(row[7]), // 5+ sinif üçün az = row[8], digərləri üçün row[7]
            math: Number(row[2]) >= 5 ? Number(row[10]) : Number(row[8]), // 5+ sinif üçün math = row[10], digərləri üçün row[8]
            lifeKnowledge: Number(row[2]) >= 5 ? undefined : Number(row[9]), // 5+ sinif üçün lifeKnowledge mövcud deyil
            logic: Number(row[2]) >= 5 ? undefined : Number(row[10]), // 5+ sinif üçün logic mövcud deyil
            english: Number(row[2]) >= 5 ? Number(row[12]) : undefined, // 5+ sinif üçün english = row[12], digərləri üçün mövcud deyil
            // ---------------------------------------------------------------------
            azCount: Number(row[2]) >= 5 ? Number(row[7]) : undefined,
            mathCount: Number(row[2]) >= 5 ? Number(row[9]) : undefined,
            englishCount: Number(row[2]) >= 5 ? Number(row[11]) : undefined,
            totalScore: Number(row[2]) >= 5 ? Number(row[13]) : Number(row[11]),
            level: Number(row[2]) >= 5 ? String(row[14]) : String(row[12])
        }));
        const studentDataToInsert = rows.slice(3).map(row => ({
            code: Number(row[3]),
            lastName: String(row[4]),
            firstName: String(row[5]),
            middleName: String(row[6]),
            grade: Number(row[2]),
            // Устанавливаем maxLevel для новых студентов на основе текущего уровня
            maxLevel: (0, participation_types_1.calculateParticipationScore)(Number(row[2]) === 5 ? String(row[11]) : String(row[12]))
        }));
        // Валидация кодов студентов (10 цифр: 1000000000-9999999999)
        const correctStudentDataToInsert = studentDataToInsert.filter(data => data.code >= 1000000000 && data.code <= 9999999999);
        const invalidStudentCodes = studentDataToInsert
            .filter(data => data.code < 1000000000 || data.code > 9999999999)
            .map(data => data.code);
        // Валидация кодов учителей (извлекаем из кода студента: первые 7 цифр)
        const invalidTeacherCodes = [];
        const teacherCodesToCheck = [...new Set(correctStudentDataToInsert.map(s => Math.floor(s.code / 1000)))];
        const existingTeachers = yield teacher_model_1.default.find({ code: { $in: teacherCodesToCheck } });
        const existingTeacherCodes = new Set(existingTeachers.map(t => t.code));
        teacherCodesToCheck.forEach(teacherCode => {
            if (!existingTeacherCodes.has(teacherCode)) {
                invalidTeacherCodes.push(teacherCode);
            }
        });
        // Валидация кодов школ (извлекаем из кода учителя: первые 5 цифр)
        const invalidSchoolCodes = [];
        const schoolCodesToCheck = [...new Set(existingTeachers.map(t => Math.floor(t.code / 100)))];
        const existingSchools = yield school_model_1.default.find({ code: { $in: schoolCodesToCheck } });
        const existingSchoolCodes = new Set(existingSchools.map(s => s.code));
        schoolCodesToCheck.forEach(schoolCode => {
            if (!existingSchoolCodes.has(schoolCode)) {
                invalidSchoolCodes.push(schoolCode);
            }
        });
        // Валидация кодов районов (извлекаем из кода школы: первые 3 цифры)
        const invalidDistrictCodes = [];
        const districtCodesToCheck = [...new Set(existingSchools.map(s => Math.floor(s.code / 100)))];
        const existingDistricts = yield district_model_1.default.find({ code: { $in: districtCodesToCheck } });
        const existingDistrictCodes = new Set(existingDistricts.map(d => d.code));
        districtCodesToCheck.forEach(districtCode => {
            if (!existingDistrictCodes.has(districtCode)) {
                invalidDistrictCodes.push(districtCode);
            }
        });
        const { students, studentsWithoutTeacher } = yield (0, exports.processStudentResults)(correctStudentDataToInsert);
        // нужны только те студенты, которые есть в базе и те, у кого totalScore = az + math + lifeKnowledge + logic + english
        const filtredResults = resultReadedData.filter(result => students.map(student => student.code).includes(result.studentCode)
            && result.totalScore === (result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0))
            && result.totalScore > 0);
        // Студенты с некорректными результатами (неправильная сумма баллов)
        const studentsWithIncorrectResults = resultReadedData.filter(result => students.map(student => student.code).includes(result.studentCode)
            && result.totalScore !== (result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0))).map(result => ({
            studentCode: result.studentCode,
            totalScore: result.totalScore,
            calculatedTotal: result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0),
            az: result.az,
            math: result.math,
            lifeKnowledge: result.lifeKnowledge,
            logic: result.logic,
            english: result.english
        }));
        // Подготавливаем массив обновлений для существующих студентов
        const studentUpdates = [];
        const resultsToInsert = filtredResults.map(result => {
            const student = students.find(student => student.code === result.studentCode);
            const currentLevelScore = (0, participation_types_1.calculateParticipationScore)(result.level);
            let developmentScore = 0;
            // Проверяем, есть ли у студента maxLevel и сравниваем
            if (student.maxLevel !== undefined && student.maxLevel !== null) {
                if (currentLevelScore > student.maxLevel) {
                    // Текущий уровень больше maxLevel - устанавливаем developmentScore = 10
                    developmentScore = 10;
                    // Обновляем maxLevel у студента
                    studentUpdates.push({
                        updateOne: {
                            filter: { _id: student._id },
                            update: { $set: { maxLevel: currentLevelScore } }
                        }
                    });
                }
            }
            else {
                // Если maxLevel не установлен, устанавливаем его в текущее значение
                studentUpdates.push({
                    updateOne: {
                        filter: { _id: student._id },
                        update: { $set: { maxLevel: currentLevelScore } }
                    }
                });
            }
            return {
                student: student._id,
                exam: result.examId,
                grade: result.grade,
                disciplines: {
                    az: Number(result.az) || 0,
                    math: Number(result.math) || 0,
                    lifeKnowledge: Number(result.lifeKnowledge) || undefined,
                    logic: Number(result.logic) || undefined,
                    english: Number(result.english) || undefined
                },
                questionCounts: {
                    az: Number(result.azCount) || 0,
                    math: Number(result.mathCount) || 0,
                    english: Number(result.englishCount) || 0
                },
                totalScore: result.totalScore,
                level: result.level,
                score: 1,
                participationScore: currentLevelScore,
                developmentScore: developmentScore,
                month: month,
                year: year
            };
        });
        // Обновляем maxLevel у существующих студентов
        if (studentUpdates.length > 0) {
            yield student_model_1.default.bulkWrite(studentUpdates);
        }
        // Remove the uploaded file
        (0, file_service_1.deleteFile)(filePath);
        const bulkOps = resultsToInsert.map(result => ({
            updateOne: {
                filter: { student: result.student, exam: result.exam },
                update: { $set: result },
                upsert: true
            }
        }));
        const results = yield studentResult_model_1.default.bulkWrite(bulkOps);
        return {
            processedData: resultsToInsert,
            results,
            validationErrors: {
                incorrectStudentCodes: [...new Set(invalidStudentCodes)],
                studentsWithoutTeacher,
                studentsWithIncorrectResults: studentsWithIncorrectResults.map(s => ({
                    code: s.studentCode,
                    reason: `Səhv cəm: ${s.calculatedTotal}, Faylda: ${s.totalScore}`
                }))
            }
        };
    }
    catch (error) {
        (0, file_service_1.deleteFile)(filePath);
        throw error;
    }
});
exports.processStudentResultsFromExcel = processStudentResultsFromExcel;
const deleteResultsByExamId = (examId) => __awaiter(void 0, void 0, void 0, function* () {
    const objectId = new mongoose_1.Types.ObjectId(examId);
    // Шаг 1: Найти всех студентов, у которых есть результаты по этому экзамену
    const studentResults = yield studentResult_model_1.default.find({ exam: objectId }).select("student");
    const studentIds = studentResults.map(result => result.student);
    // Шаг 2: Удалить результаты экзамена
    const deletedResults = yield studentResult_model_1.default.deleteMany({ exam: objectId });
    // Шаг 3: Очистить поле `status` у найденных студентов
    if (studentIds.length > 0) {
        yield student_model_1.default.updateMany({ _id: { $in: studentIds } }, { $unset: { status: "" } });
    }
    return { deletedCount: deletedResults.deletedCount || 0 };
});
exports.deleteResultsByExamId = deleteResultsByExamId;
