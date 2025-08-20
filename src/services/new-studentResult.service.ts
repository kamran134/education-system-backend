import { DeleteResult, Types } from "mongoose";
import Exam from "../models/exam.model";
import Student, { IStudent, IStudentInput } from "../models/student.model";
import StudentResult, { IStudentResult, IStudentResultsGrouped, IStudentResultInput } from "../models/studentResult.model";
import { calculateLevel, calculateLevelNumb } from "./common.service";
import { getExamsByMonthYear } from "./exam.service";
import { assignTeacherToStudent } from "./student.service";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult } from "../types/common.types";

export class StudentResultService {
    async findById(id: string): Promise<IStudentResult | null> {
        return await StudentResult.findById(id)
            .populate('student')
            .populate('exam');
    }

    async getResultsByStudentId(studentId: Types.ObjectId): Promise<IStudentResult[]> {
        return await StudentResult.find({ student: studentId }).populate('exam');
    }

    async getResultsByExamId(examId: Types.ObjectId): Promise<IStudentResult[]> {
        return await StudentResult.find({ exam: examId })
            .populate('student')
            .populate('exam');
    }

    async create(resultData: IStudentResultInput): Promise<IStudentResult> {
        const result = new StudentResult(resultData);
        return await result.save();
    }

    async createBulk(resultsData: IStudentResultInput[]): Promise<BulkOperationResult> {
        const bulkOps = resultsData.map(result => ({
            updateOne: {
                filter: { student: result.student, exam: result.exam },
                update: { $set: result },
                upsert: true
            }
        }));

        const result = await StudentResult.bulkWrite(bulkOps);
        return {
            insertedCount: result.upsertedCount || 0,
            modifiedCount: result.modifiedCount || 0,
            deletedCount: 0,
            errors: []
        };
    }

    async update(id: string, updateData: Partial<IStudentResultInput>): Promise<IStudentResult> {
        const updatedResult = await StudentResult.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('student exam');

        if (!updatedResult) {
            throw new Error('Student result not found');
        }

        return updatedResult;
    }

    async delete(id: string): Promise<void> {
        const result = await StudentResult.findByIdAndDelete(id);
        if (!result) {
            throw new Error('Student result not found');
        }
    }

    async deleteByStudentId(studentId: Types.ObjectId): Promise<DeleteResult> {
        return await StudentResult.deleteMany({ student: studentId });
    }

    async deleteBulkByStudentIds(studentIds: Types.ObjectId[]): Promise<DeleteResult> {
        return await StudentResult.deleteMany({ student: { $in: studentIds } });
    }

    async deleteByExamId(examId: Types.ObjectId): Promise<DeleteResult> {
        return await StudentResult.deleteMany({ exam: examId });
    }

    async getFilteredResults(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IStudentResult[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            StudentResult.find(filter)
                .populate('student exam')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            StudentResult.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async processStudentResults(studentDataToInsert: IStudentInput[]): Promise<{students: IStudent[], studentsWithoutTeacher: number[]}> {
        const studentCodes = studentDataToInsert.map(item => item.code);
        const existingStudents = await Student.find({ code: { $in: studentCodes } });
        const newStudents = studentDataToInsert.filter(student => 
            !existingStudents.map(d => d.code).includes(student.code)
        );

        // Assign teacher to student
        await Promise.all(newStudents.map(async (student) => {
            await assignTeacherToStudent(student);
        }));

        const studentsWithTeacher = newStudents.filter(student => student.teacher);
        const studentsWithoutTeacher = newStudents
            .filter(student => !student.teacher)
            .map(student => student.code);
        
        const newStudentsDocs = await Student.insertMany(studentsWithTeacher);
        const newStudentsPlain = newStudentsDocs.map(doc => doc.toObject() as IStudent);
        const existingStudentsPlain = existingStudents.map(doc => doc.toObject() as IStudent);
        const allStudents = existingStudentsPlain.concat(newStudentsPlain);
        
        return { students: allStudents, studentsWithoutTeacher };
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

        if (filters.examIds && filters.examIds.length > 0) {
            filter.exam = { $in: filters.examIds };
        }

        return filter;
    }
}

// Legacy functions for backward compatibility
const studentResultService = new StudentResultService();

export const processStudentResults = async (studentDataToInsert: IStudentInput[]): 
    Promise<{students: IStudent[], studentsWithoutTeacher: number[]}> => {
    return await studentResultService.processStudentResults(studentDataToInsert);
}

export const deleteStudentResultsByExamId = async (examId: string): Promise<DeleteResult> => {
    return await StudentResult.deleteMany({ exam: examId });
}

export const deleteStudentResultsByStudentId = async (studentId: string): Promise<DeleteResult> => {
    return await StudentResult.deleteMany({ student: studentId });
}

export const deleteStudentResultsByExams = async (examIds: string[]): Promise<DeleteResult> => {
    return await StudentResult.deleteMany({ exam: { $in: examIds } });
}

export const deleteStudentResultsByStudents = async (studentIds: string[]): Promise<DeleteResult> => {
    return await StudentResult.deleteMany({ student: { $in: studentIds } });
}

// Additional legacy functions that may be used elsewhere
export const markAllDevelopingStudents = async (): Promise<void> => {
    console.log("🔄 Обновление статусов студентов...");
    
    const studentResultsGrouped: IStudentResultsGrouped[] = await getStudentResultsGroupedByStudent();
    if (studentResultsGrouped.length === 0) return;
    
    const bulkOperations = [];
    console.log("Найдено ", studentResultsGrouped.length, " студентов с результатами экзаменов.");

    for (const student of studentResultsGrouped) {
        if (student.results.length <= 1) continue;

        // Reset status for newest result
        student.results[0].status = "";
        student.results[0].score = 1;

        let maxTotalScore = student.results[0].totalScore;
        let maxLevel = calculateLevelNumb(maxTotalScore);

        for (let i = 1; i < student.results.length; i++) {
            const currentResult = student.results[i];
            
            currentResult.status = "";
            currentResult.score = 1;

            if (calculateLevelNumb(currentResult.totalScore) > maxLevel) {
                currentResult.status = "İnkişaf edən şagird";
                currentResult.score += 10;
                maxLevel = calculateLevelNumb(currentResult.totalScore);
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
        await StudentResult.bulkWrite(bulkOperations);
        console.log(`✅ Обновлено ${bulkOperations.length} статусов студентов.`);
    } else {
        console.log("Не найдено студентов для обновления.");
    }

    console.log("✅ Статусы студентов обновлены.");
}

export const getStudentResultsGroupedByStudent = async (): Promise<IStudentResultsGrouped[]> => {
    return await StudentResult.aggregate([
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
}

export const markDevelopingStudents = async (month: number, year: number): Promise<void> => {
    try {
        const bulkOperations = [];
        console.log(`🔄 Поиск развивающихся студентов за ${month}/${year}...`);

        const examIds = await getExamsByMonthYear(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }

        console.log(`Найдено экзаменов: ${examIds.length}`);

        const results: IStudentResult[] = await StudentResult.find({
            exam: { $in: examIds }
        });

        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }

        const gradeGroups: Record<number, IStudentResult[]> = results.reduce((acc, result) => {
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
        }, {} as Record<number, IStudentResult[]>);

        for (const [gradeKey, gradeResults] of Object.entries(gradeGroups)) {
            const grade = parseInt(gradeKey);
            console.log(`Обработка класса ${grade}: ${gradeResults.length} результатов`);

            for (const currentResult of gradeResults) {
                if (!currentResult.student || typeof currentResult.student === 'string') {
                    console.warn("Student ID отсутствует или является строкой:", currentResult);
                    continue;
                }

                const currentLevel = calculateLevelNumb(currentResult.totalScore);

                const previousResults: IStudentResult[] = await StudentResult.find({
                    student: currentResult.student,
                    exam: { $nin: examIds }
                }).populate('exam');

                if (!previousResults.length) {
                    continue;
                }

                let maxPreviousLevel = 0;
                for (const prevResult of previousResults) {
                    const prevLevel = calculateLevelNumb(prevResult.totalScore);
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
            await StudentResult.bulkWrite(bulkOperations);
            console.log(`✅ Найдено и обновлено ${bulkOperations.length} развивающихся студентов за ${month}/${year}.`);
        } else {
            console.log(`Не найдено развивающихся студентов за ${month}/${year}.`);
        }
    } catch (error) {
        console.error("Ошибка в markDevelopingStudents:", error);
    }
}

export const markTopStudents = async (month: number, year: number): Promise<void> => {
    try {
        const bulkOperations = [];
        console.log(`🔄 Определение лучших студентов месяца за ${month}/${year}...`);

        const examIds = await getExamsByMonthYear(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }

        console.log(`Найдено экзаменов: ${examIds.length}`);

        const results: IStudentResult[] = await StudentResult.find({
            exam: { $in: examIds }
        });

        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }

        const gradeGroups: Record<number, IStudentResult[]> = results.reduce((acc, result) => {
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
        }, {} as Record<number, IStudentResult[]>);

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
            await StudentResult.bulkWrite(bulkOperations);
            console.log(`✅ Определено и обновлено ${bulkOperations.length} лучших студентов месяца за ${month}/${year}.`);
        } else {
            console.log(`Не найдено лучших студентов месяца за ${month}/${year}.`);
        }
    } catch (error) {
        console.error("Ошибка в markTopStudents:", error);
    }
}

export const markTopStudentsRepublic = async (month: number, year: number): Promise<void> => {
    try {
        const bulkOperations = [];
        console.log(`🔄 Определение лучших студентов республики за ${month}/${year}...`);

        const examIds = await getExamsByMonthYear(month, year);
        if (!examIds.length) {
            console.log("Не найдены экзамены за указанный период.");
            return;
        }

        console.log(`Найдено экзаменов: ${examIds.length}`);

        const results: IStudentResult[] = await StudentResult.find({
            exam: { $in: examIds }
        });

        if (!results || !results.length) {
            console.log("Нет результатов экзаменов за этот период.");
            return;
        }

        const gradeGroups: Record<number, IStudentResult[]> = results.reduce((acc, result) => {
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
        }, {} as Record<number, IStudentResult[]>);

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
            await StudentResult.bulkWrite(bulkOperations);
            console.log(`✅ Определено и обновлено ${bulkOperations.length} лучших студентов республики за ${month}/${year}.`);
        } else {
            console.log(`Не найдено лучших студентов республики за ${month}/${year}.`);
        }
    } catch (error) {
        console.error("Ошибка в markTopStudentsRepublic:", error);
    }
}
