import Exam, { IExam } from "../models/exam.model";
import District, { IDistrict } from "../models/district.model";
import School, { ISchool } from "../models/school.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { LevelScore } from "../types/levelScore.enum";
import { markAllDevelopingStudents, markDevelopingStudents, markTopStudents, markTopStudentsRepublic } from "./studentResult.service";
import { countDistrictsRates } from "./district.service";
import { FilterOptions } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { Types } from "mongoose";

export interface StatisticsFilter extends FilterOptions {
    month?: string;
}

export class StatsService {
    // Функция для проверки, является ли уровень лицейным
    private isLiceyLevel(level: string): boolean {
        const normalizedLevel = level.trim().toUpperCase();
        return normalizedLevel === 'LISEY' || normalizedLevel === 'LISE' || normalizedLevel.includes('LISEY');
    }

    async resetStats(): Promise<void> {
        console.log("🔄 Сброс статистики...");
        await District.updateMany({}, { score: 0, averageScore: 0, rate: 0 });
        // Reset status and recalculate base score from level mapping.
        // Use aggregation-style pipeline update (MongoDB 4.2+) to derive numeric score from level.
        await StudentResult.updateMany({}, [
            {
                $set: {
                    status: "",
                    score: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$level", "E"] }, then: LevelScore.E },
                                { case: { $eq: ["$level", "D"] }, then: LevelScore.D },
                                { case: { $eq: ["$level", "C"] }, then: LevelScore.C },
                                { case: { $eq: ["$level", "B"] }, then: LevelScore.B },
                                { case: { $eq: ["$level", "A"] }, then: LevelScore.A },
                                { case: { $in: ["$level", ["Lisey", "Lise", "Lisey "]] }, then: LevelScore.Lisey }
                            ],
                            default: 0
                        }
                    }
                }
            }
        ] as any); // cast as any to satisfy TS for pipeline form
        console.log("✅ Статистика сброшена.");
    }

    async updateStatsOld(): Promise<number> {
        try {
            // Reset all statistics
            await this.resetStats();
            await countDistrictsRates();
            
            // Get all exam dates
            const exams: IExam[] = await Exam.find({}, { date: 1 });
            if (!exams.length) {
                console.log("Нет экзаменов в базе.");
                return 404;
            }

            // Create unique months set
            const uniqueMonths = new Set<string>();
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
                    if (a.year !== b.year) return a.year - b.year;
                    return a.month - b.month;
                });

            console.log(`Найдено ${sortedMonths.length} уникальных месяцев с экзаменами.`);

            // Process each month sequentially
            for (const monthData of sortedMonths) {
                console.log(`🔄 Обработка месяца: ${monthData.key}...`);
                
                await markDevelopingStudents(monthData.month, monthData.year);
                await markTopStudents(monthData.month, monthData.year);
                await markTopStudentsRepublic(monthData.month, monthData.year);
            }

            // Final processing for all developing students
            await markAllDevelopingStudents();
            await countDistrictsRates();

            console.log("✅ Статистика обновлена успешно.");
            return 200;
        } catch (error) {
            console.error("Ошибка при обновлении статистики:", error);
            throw error;
        }
    }

    async updateStats(): Promise<number> {
        try {
            console.log("🔄 Начинаем обновление статистики...");

            // Получаем текущую дату
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1;
            const currentYear = currentDate.getFullYear();

            console.log(`📅 Обрабатываем месяц: ${currentMonth}/${currentYear}`);

            // Шаг 1: Получаем все результаты студентов за текущий месяц
            const studentResults = await StudentResult.find({ 
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
            await StudentResult.updateMany(
                { month: currentMonth, year: currentYear },
                { 
                    $set: { 
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0
                    }
                }
            );

            // Шаг 3: Группируем по классам (grade) и районам (district)
            console.log("🔄 Группируем результаты по классам и районам...");
            
            const gradeDistrictGroups: Map<string, IStudentResult[]> = new Map();
            const gradeGroups: Map<number, IStudentResult[]> = new Map();

            for (const result of studentResults) {
                if (!result.student || !result.student.district) continue;
                
                const grade = result.grade;
                const districtId = (result.student.district as any)._id.toString();
                const gradeDistrictKey = `${grade}-${districtId}`;

                // Группировка по классам и районам
                if (!gradeDistrictGroups.has(gradeDistrictKey)) {
                    gradeDistrictGroups.set(gradeDistrictKey, []);
                }
                gradeDistrictGroups.get(gradeDistrictKey)!.push(result);

                // Группировка только по классам (для республиканского уровня)
                if (!gradeGroups.has(grade)) {
                    gradeGroups.set(grade, []);
                }
                gradeGroups.get(grade)!.push(result);
            }

            // Шаг 4: Находим лучших студентов в каждом классе и районе
            console.log("🏆 Определяем лучших студентов месяца по районам...");
            
            const districtTopStudentUpdates: any[] = [];
            
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
                } else {
                    // Если нет лицейных с максимальным баллом, никого не награждаем
                    console.log(`📍 Класс ${grade}, район ${districtId}: максимум ${maxTotalScore} баллов (не лицейный уровень), никого не награждаем`);
                }
            }

            // Применяем обновления для студентов месяца по районам
            if (districtTopStudentUpdates.length > 0) {
                await StudentResult.bulkWrite(districtTopStudentUpdates);
                console.log(`✅ Обновлено ${districtTopStudentUpdates.length} студентов месяца по районам`);
            }

            // Шаг 5: Находим лучших студентов в каждом классе по всей республике
            console.log("🏆 Определяем лучших студентов месяца по республике...");
            
            const republicTopStudentUpdates: any[] = [];
            
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
                } else {
                    // Если нет лицейных с максимальным баллом, никого не награждаем
                    console.log(`🎯 Класс ${grade} (республика): максимум ${maxTotalScore} баллов (не лицейный уровень), никого не награждаем`);
                }
            }

            // Применяем обновления для студентов месяца по республике
            if (republicTopStudentUpdates.length > 0) {
                await StudentResult.bulkWrite(republicTopStudentUpdates);
                console.log(`✅ Обновлено ${republicTopStudentUpdates.length} студентов месяца по республике`);
            }

            console.log("✅ Статистика обновлена успешно!");
            return 200;

        } catch (error) {
            console.error("❌ Ошибка при обновлении статистики:", error);
            throw error;
        }
    }

    async getStudentStatistics(filters: StatisticsFilter): Promise<{
        studentsOfMonth: IStudentResult[];
        studentsOfMonthByRepublic: IStudentResult[];
        developingStudents: IStudentResult[];
    }> {
        if (!filters.month) {
            throw new Error('Month is required');
        }

        const { startDate, endDate } = RequestParser.parseMonthRange(filters.month);

        let examIds: Types.ObjectId[];
        if (filters.examIds && filters.examIds.length > 0) {
            examIds = filters.examIds;
        } else {
            const exams = await Exam.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
            examIds = exams.map(e => e._id as Types.ObjectId);
        }

        if (examIds.length === 0) {
            throw new Error('No exams found for the specified month');
        }

        // Build aggregation pipeline
        const pipeline = this.buildStudentStatsPipeline(filters, examIds);
        const studentResults = await StudentResult.aggregate(pipeline);
        
        const studentsOfMonth = studentResults.filter(r => r.status?.match(/Ayın şagirdi/i));
        const studentsOfMonthByRepublic = studentResults.filter(r => r.status?.match(/Respublika üzrə ayın şagirdi/i));
        const developingStudents = studentResults.filter(r => r.status?.match(/İnkişaf edən şagird/i));

        return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
    }

    async getStatisticsByExam(examId: string): Promise<{
        studentsOfMonth: IStudentResult[];
        studentsOfMonthByRepublic: IStudentResult[];
        developingStudents: IStudentResult[];
    }> {
        const studentResults: IStudentResult[] = await StudentResult.find({ exam: examId })
            .populate("exam")
            .populate({ 
                path: "student", 
                populate: [
                    { path: "district", model: "District" },
                    { path: "school", model: "School" },
                    { path: "teacher", model: "Teacher" }
                ]
            });

        const studentsOfMonth = studentResults.filter(r => r.status?.match(/Ayın şagirdi/i));
        const studentsOfMonthByRepublic = studentResults.filter(r => r.status?.match(/Respublika üzrə ayın şagirdi/i));
        const developingStudents = studentResults.filter(r => r.status?.match(/İnkişaf edən şagird/i));

        return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
    }

    async getTeacherStatistics(
        filters: FilterOptions, 
        sortColumn: string, 
        sortDirection: string
    ): Promise<{ teachers: ITeacher[] }> {
        const filter: any = { 
            score: { $exists: true }, 
            averageScore: { $exists: true } 
        };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        
        const teachers = await Teacher
            .find(filter)
            .populate("school")
            .populate({ path: "school", populate: { path: "district", model: "District" } })
            .sort(sortOptions);

        return { teachers };
    }

    async getSchoolStatistics(
        filters: FilterOptions,
        sortColumn: string,
        sortDirection: string
    ): Promise<{ schools: ISchool[] }> {
        const filter: any = { 
            score: { $exists: true }, 
            averageScore: { $exists: true } 
        };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const schools = await School
            .find(filter)
            .populate("district")
            .sort(sortOptions);

        return { schools };
    }

    async getDistrictStatistics(
        filters: FilterOptions,
        sortColumn: string,
        sortDirection: string
    ): Promise<{ districts: IDistrict[] }> {
        const filter: any = {};

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            filter.code = { $gte: start, $lte: end };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const districts = await District
            .find(filter)
            .sort(sortOptions);

        return { districts };
    }

    private buildStudentStatsPipeline(filters: StatisticsFilter, examIds: Types.ObjectId[]): any[] {
        let codeString = '';
        let codeStringEnd = '';

        if (filters.code) {
            codeString = filters.code.toString().padEnd(10, '0');
            codeStringEnd = filters.code.toString().padEnd(10, '9');
        }

        const pipeline: any[] = [
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
        const matchConditions: any = {};
        
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
}

// Legacy function exports for backward compatibility
const statsService = new StatsService();

export const resetStats = () => statsService.resetStats();
export const updateStats = () => statsService.updateStats();
