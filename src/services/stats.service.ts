import Exam, { IExam } from "../models/exam.model";
import District, { IDistrict } from "../models/district.model";
import School, { ISchool } from "../models/school.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { markAllDevelopingStudents, markDevelopingStudents, markTopStudents, markTopStudentsRepublic } from "./studentResult.service";
import { countDistrictsRates } from "./district.service";
import { FilterOptions } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { Types } from "mongoose";

export interface StatisticsFilter extends FilterOptions {
    month?: string;
}

export class StatsService {
    async resetStats(): Promise<void> {
        console.log("🔄 Сброс статистики...");
        await District.updateMany({}, { score: 0, averageScore: 0, rate: 0 });
        await StudentResult.updateMany({}, { status: "", score: 1 });
        console.log("✅ Статистика сброшена.");
    }

    async updateStats(): Promise<number> {
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
