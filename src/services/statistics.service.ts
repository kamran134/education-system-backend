import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import Exam from "../models/exam.model";
import { 
    StatisticsFilter, 
    YearlyStatistics, 
    MonthlyStatistics, 
    StatisticsResponse,
    StatusStatistics,
    LevelStatistics
} from "../types/statistics.types";

export class StatisticsService {
    /**
     * Получить текущий учебный год
     * Учебный год: сентябрь - июнь
     */
    private getCurrentAcademicYear(): number {
        const now = new Date();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentYear = now.getFullYear();
        
        // Если сейчас сентябрь-декабрь, учебный год начался в этом году
        // Если январь-август, учебный год начался в прошлом году
        return currentMonth >= 9 ? currentYear : currentYear - 1;
    }

    /**
     * Получить даты начала и конца учебного года
     */
    private getAcademicYearDates(year: number): { startDate: Date, endDate: Date } {
        const startDate = new Date(year, 8, 1); // 1 сентября
        const endDate = new Date(year + 1, 5, 30, 23, 59, 59); // 30 июня
        return { startDate, endDate };
    }

    /**
     * Получить общую статистику за учебный год
     */
    async getYearlyStatistics(filters: StatisticsFilter = {}): Promise<YearlyStatistics> {
        const year = filters.year || this.getCurrentAcademicYear();
        const { startDate, endDate } = this.getAcademicYearDates(year);

        // Получаем все экзамены за учебный год
        const exams = await Exam.find({
            date: { $gte: startDate, $lt: endDate }
        }).select('_id');
        const examIds = exams.map(e => e._id);

        // Строим фильтр для студентов
        const studentFilter: any = {};
        if (filters.districtIds && filters.districtIds.length > 0) {
            studentFilter.district = { $in: filters.districtIds };
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            studentFilter.school = { $in: filters.schoolIds };
        }
        if (filters.grades && filters.grades.length > 0) {
            studentFilter.grade = { $in: filters.grades };
        }

        // Получаем общее количество студентов с учетом фильтров
        const totalStudents = await Student.countDocuments(studentFilter);

        // Получаем все результаты за учебный год с учетом фильтров
        const resultFilter: any = { exam: { $in: examIds } };
        
        // Получаем студентов для фильтрации результатов
        const students = await Student.find(studentFilter).select('_id');
        const studentIds = students.map(s => s._id);
        resultFilter.student = { $in: studentIds };

        const results = await StudentResult.find(resultFilter).populate('student');

        // Подсчитываем уникальных студентов по статусам
        const studentsOfMonthSet = new Set();
        const republicStudentsOfMonthSet = new Set();
        const developingStudentsSet = new Set();

        let totalScore = 0;
        let scoreCount = 0;

        results.forEach(result => {
            const studentId = (result.student as any)._id.toString();

            // Студенты месяца
            if (result.studentOfTheMonthScore && result.studentOfTheMonthScore > 0) {
                studentsOfMonthSet.add(studentId);
            }

            // Студенты месяца по республике
            if (result.republicWideStudentOfTheMonthScore && result.republicWideStudentOfTheMonthScore > 0) {
                republicStudentsOfMonthSet.add(studentId);
            }

            // Развивающиеся студенты
            if (result.developmentScore && result.developmentScore > 0) {
                developingStudentsSet.add(studentId);
            }

            // Средний балл
            if (result.score !== undefined && result.score !== null) {
                totalScore += result.score;
                scoreCount++;
            }
        });

        // Подсчитываем студентов по уровням
        const levelCounts = {
            E: 0,
            D: 0,
            C: 0,
            B: 0,
            A: 0,
            Lisey: 0
        };

        const studentsWithLevels = await Student.find(studentFilter).select('maxLevel');
        studentsWithLevels.forEach(student => {
            const level = student.maxLevel;
            if (level === 1) levelCounts.E++;
            else if (level === 2) levelCounts.D++;
            else if (level === 3) levelCounts.C++;
            else if (level === 4) levelCounts.B++;
            else if (level === 5) levelCounts.A++;
            else if (level === 6) levelCounts.Lisey++;
        });

        // Формируем результат
        const calculatePercentage = (count: number): number => {
            return totalStudents > 0 ? Math.round((count / totalStudents) * 100 * 100) / 100 : 0;
        };

        const levelStatistics: LevelStatistics = {
            E: { count: levelCounts.E, percentage: calculatePercentage(levelCounts.E) },
            D: { count: levelCounts.D, percentage: calculatePercentage(levelCounts.D) },
            C: { count: levelCounts.C, percentage: calculatePercentage(levelCounts.C) },
            B: { count: levelCounts.B, percentage: calculatePercentage(levelCounts.B) },
            A: { count: levelCounts.A, percentage: calculatePercentage(levelCounts.A) },
            Lisey: { count: levelCounts.Lisey, percentage: calculatePercentage(levelCounts.Lisey) }
        };

        return {
            totalStudents,
            studentsOfMonth: {
                count: studentsOfMonthSet.size,
                percentage: calculatePercentage(studentsOfMonthSet.size)
            },
            republicStudentsOfMonth: {
                count: republicStudentsOfMonthSet.size,
                percentage: calculatePercentage(republicStudentsOfMonthSet.size)
            },
            developingStudents: {
                count: developingStudentsSet.size,
                percentage: calculatePercentage(developingStudentsSet.size)
            },
            averageScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 100) / 100 : 0,
            levelStatistics
        };
    }

    /**
     * Получить помесячную статистику
     */
    async getMonthlyStatistics(filters: StatisticsFilter = {}): Promise<MonthlyStatistics[]> {
        const year = filters.year || this.getCurrentAcademicYear();
        const { startDate, endDate } = this.getAcademicYearDates(year);

        // Строим фильтр для студентов
        const studentFilter: any = {};
        if (filters.districtIds && filters.districtIds.length > 0) {
            studentFilter.district = { $in: filters.districtIds };
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            studentFilter.school = { $in: filters.schoolIds };
        }
        if (filters.grades && filters.grades.length > 0) {
            studentFilter.grade = { $in: filters.grades };
        }

        const students = await Student.find(studentFilter).select('_id');
        const studentIds = students.map(s => s._id);

        // Получаем экзамены с группировкой по месяцам
        const exams = await Exam.find({
            date: { $gte: startDate, $lt: endDate }
        }).sort({ date: 1 });

        // Группируем экзамены по месяцам
        const monthsMap = new Map<string, any[]>();
        exams.forEach(exam => {
            const monthKey = `${exam.date.getFullYear()}-${String(exam.date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthsMap.has(monthKey)) {
                monthsMap.set(monthKey, []);
            }
            monthsMap.get(monthKey)!.push(exam._id);
        });

        // Названия месяцев на азербайджанском
        const monthNames = [
            'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
            'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'
        ];

        const monthlyStats: MonthlyStatistics[] = [];

        for (const [monthKey, examIds] of monthsMap) {
            const [yearStr, monthStr] = monthKey.split('-');
            const monthIndex = parseInt(monthStr) - 1;
            const monthName = monthNames[monthIndex];

            // Получаем результаты за месяц
            const results = await StudentResult.find({
                exam: { $in: examIds },
                student: { $in: studentIds }
            });

            const totalResults = results.length;

            // Подсчитываем уникальных студентов по статусам
            const studentsOfMonthSet = new Set();
            const republicStudentsOfMonthSet = new Set();
            const developingStudentsSet = new Set();

            results.forEach(result => {
                const studentId = result.student.toString();

                if (result.studentOfTheMonthScore && result.studentOfTheMonthScore > 0) {
                    studentsOfMonthSet.add(studentId);
                }

                if (result.republicWideStudentOfTheMonthScore && result.republicWideStudentOfTheMonthScore > 0) {
                    republicStudentsOfMonthSet.add(studentId);
                }

                if (result.developmentScore && result.developmentScore > 0) {
                    developingStudentsSet.add(studentId);
                }
            });

            const calculatePercentage = (count: number): number => {
                return totalResults > 0 ? Math.round((count / totalResults) * 100 * 100) / 100 : 0;
            };

            monthlyStats.push({
                month: monthKey,
                monthName,
                totalResults,
                studentsOfMonth: {
                    count: studentsOfMonthSet.size,
                    percentage: calculatePercentage(studentsOfMonthSet.size)
                },
                republicStudentsOfMonth: {
                    count: republicStudentsOfMonthSet.size,
                    percentage: calculatePercentage(republicStudentsOfMonthSet.size)
                },
                developingStudents: {
                    count: developingStudentsSet.size,
                    percentage: calculatePercentage(developingStudentsSet.size)
                }
            });
        }

        return monthlyStats;
    }

    /**
     * Получить полную статистику (годовая + помесячная)
     */
    async getStatistics(filters: StatisticsFilter = {}): Promise<StatisticsResponse> {
        const [yearly, monthly] = await Promise.all([
            this.getYearlyStatistics(filters),
            this.getMonthlyStatistics(filters)
        ]);

        return { yearly, monthly };
    }
}
