import Exam, { IExam } from "../models/exam.model";
import District, { IDistrict } from "../models/district.model";
import School, { ISchool } from "../models/school.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { LevelScore } from "../types/levelScore.enum";
import { studentResultService } from "./studentResult.service";
import { districtService } from "./district.service";
import { FilterOptions } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { Types } from "mongoose";
import { getCurrentAcademicYear } from '../utils/academic-year.util';
import { assignPlaces } from '../utils/ranking.util';
import { MemoryCache } from '../utils/memory-cache.util';

export interface StatisticsFilter extends FilterOptions {
    month?: string;
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
}

export class StatsService {
    private cache = new MemoryCache(5 * 60 * 1000); // 5 min TTL

    // Инвалидирует кэш после обновления статистики
    invalidateCache(): void {
        this.cache.clear();
    }
    // Функция для проверки, является ли уровень лицейным
    private isLiceyLevel(level: string): boolean {
        const normalizedLevel = level.trim().toUpperCase();
        return normalizedLevel === 'LISEY' || normalizedLevel === 'LISE' || normalizedLevel.includes('LISEY');
    }

    /**
     * Projects the current academic year's rating values onto the root of each item.
     * This allows existing score/averageScore/place-based logic to work with the ratings[] model.
     */
    private flattenCurrentYearRating(items: any[], currentYear: number): void {
        items.forEach((item: any) => {
            const yr = (item.ratings || []).find((r: any) => r.year === currentYear);
            item.score = yr?.score ?? 0;
            item.averageScore = yr?.averageScore ?? 0;
            item.place = yr?.place ?? null;
        });
    }

    async resetStats(): Promise<void> {
        console.log("🔄 Сброс статистики...");
        const currentYear = getCurrentAcademicYear();
        await District.updateMany({}, [{
            $set: {
                ratings: {
                    $concatArrays: [
                        { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                        [{ year: currentYear, score: 0, averageScore: 0, place: null }]
                    ]
                },
                rate: 0
            }
        }] as any);
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
            await districtService.countDistrictsRates();
            const exams: IExam[] = await Exam.find({}, { date: 1 });
            if (!exams.length) {
                console.log("Нет экзаменов в базе.");
                return 404;
            }

            // Create unique months set
            const uniqueMonths = new Set<string>();
            for (const exam of exams) {
                const date = new Date(exam.date);
                // Используем UTC-методы — даты хранятся как UTC midnight
                const year = date.getUTCFullYear();
                const month = date.getUTCMonth() + 1;
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
                
                await studentResultService.markDevelopingStudents(monthData.month, monthData.year);
                await studentResultService.markTopStudents(monthData.month, monthData.year);
                await studentResultService.markTopStudentsRepublic(monthData.month, monthData.year);
            }

            // Final processing for all developing students
            await studentResultService.markAllDevelopingStudents();
            await districtService.countDistrictsRates();

            console.log("✅ Статистика обновлена успешно.");
            this.cache.clear();
            return 200;
        } catch (error) {
            console.error("Ошибка при обновлении статистики:", error);
            throw error;
        }
    }

    /**
     * Обновляет статистику для всех месяцев учебного года (сентябрь-июнь)
     * Проходит по каждому месяцу от сентября до июня и вызывает обновление статистики
     * После завершения обновляет статистику районов, школ и учителей
     */
    async updateAllStats(): Promise<number> {
        try {
            console.log("🔄 Начинаем полное обновление статистики за весь учебный год...");

            // Получаем текущую дату для определения учебного года
            const currentDate = new Date();
            const currentMonth = currentDate.getMonth() + 1; // 1-12
            const currentYear = currentDate.getFullYear();

            // Определяем учебный год: если сейчас сентябрь-декабрь, то учебный год текущий->следующий
            // если январь-август, то учебный год предыдущий->текущий
            let academicYearStart: number;
            let academicYearEnd: number;
            
            if (currentMonth >= 9) { // сентябрь-декабрь
                academicYearStart = currentYear;
                academicYearEnd = currentYear + 1;
            } else { // январь-август
                academicYearStart = currentYear - 1;
                academicYearEnd = currentYear;
            }

            console.log(`📅 Учебный год: ${academicYearStart}/${academicYearEnd}`);

            // ============================================================
            // ШАГ 0: ИСПРАВЛЕНИЕ month/year ПО ДАТЕ ЭКЗАМЕНА
            // ============================================================
            console.log("\n🔧 Исправляем month/year в результатах по дате экзамена...");
            const allExams = await Exam.find({}, { date: 1 }).lean();
            const fixOps: any[] = [];
            for (const exam of allExams) {
                const examDate = new Date(exam.date);
                const correctMonth = examDate.getUTCMonth() + 1;
                const correctYear = examDate.getUTCFullYear();
                fixOps.push({
                    updateMany: {
                        filter: {
                            exam: exam._id,
                            $or: [
                                { month: { $ne: correctMonth } },
                                { year: { $ne: correctYear } }
                            ]
                        },
                        update: { $set: { month: correctMonth, year: correctYear } }
                    }
                });
            }
            if (fixOps.length > 0) {
                const fixResult = await StudentResult.bulkWrite(fixOps);
                console.log(`✅ Исправлено month/year для ${fixResult.modifiedCount} результатов`);
            }

            // ============================================================
            // ШАГ 1: ОБНУЛЕНИЕ ВСЕХ БАЛЛОВ И СТАТИСТИКИ
            // ============================================================
            console.log("\n🔄 Обнуляем все баллы и статистику...");
            
            // Обнуляем баллы в результатах студентов (StudentResult)
            console.log("📝 Обнуляем баллы в результатах экзаменов...");
            await StudentResult.updateMany(
                {
                    $or: [
                        { month: { $in: [9, 10, 11, 12] }, year: academicYearStart },
                        { month: { $in: [1, 2, 3, 4, 5, 6] }, year: academicYearEnd }
                    ]
                },
                {
                    $set: {
                        developmentScore: 0,
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0
                        // participationScore не трогаем - он всегда 1
                    }
                }
            );
            console.log("✅ Баллы результатов обнулены");
            
            // Обнуляем баллы студентов
            console.log("👨‍🎓 Обнуляем баллы студентов...");
            await Student.updateMany({}, [{
                $set: {
                    score: 0,
                    averageScore: 0,
                    participationScore: 0,
                    developmentScore: 0,
                    studentOfTheMonthScore: 0,
                    republicWideStudentOfTheMonthScore: 0,
                    place: null,
                    status: '',
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", academicYearStart] } } },
                            [{ year: academicYearStart, score: 0, averageScore: 0, place: null }]
                        ]
                    }
                }
            }] as any);
            console.log("✅ Баллы студентов обнулены");

            // Обнуляем баллы учителей
            console.log("👨‍🏫 Обнуляем баллы учителей...");
            await Teacher.updateMany({}, [{
                $set: {
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", academicYearStart] } } },
                            [{ year: academicYearStart, score: 0, averageScore: 0, place: null }]
                        ]
                    },
                    teacherOfTheYearScore: 0,
                    status: ''
                }
            }] as any);
            console.log("✅ Баллы учителей обнулены");

            // Обнуляем баллы школ
            console.log("🏫 Обнуляем баллы школ...");
            await School.updateMany({}, [{
                $set: {
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", academicYearStart] } } },
                            [{ year: academicYearStart, score: 0, averageScore: 0, place: null }]
                        ]
                    },
                    schoolOfTheYearScore: 0,
                    status: ''
                }
            }] as any);
            console.log("✅ Баллы школ обнулены");

            // Обнуляем баллы районов
            console.log("🏛️ Обнуляем баллы районов...");
            await District.updateMany({}, [{
                $set: {
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", academicYearStart] } } },
                            [{ year: academicYearStart, score: 0, averageScore: 0, place: null }]
                        ]
                    },
                    rate: 0,
                    districtOfTheYearScore: 0
                }
            }] as any);
            console.log("✅ Баллы районов обнулены");

            // Месяцы учебного года: сентябрь-декабрь (текущего года), январь-июнь (следующего года)
            const academicMonths = [
                { month: 9, year: academicYearStart },   // сентябрь
                { month: 10, year: academicYearStart },  // октябрь
                { month: 11, year: academicYearStart },  // ноябрь
                { month: 12, year: academicYearStart },  // декабрь
                { month: 1, year: academicYearEnd },     // январь
                { month: 2, year: academicYearEnd },     // февраль
                { month: 3, year: academicYearEnd },     // март
                { month: 4, year: academicYearEnd },     // апрель
                { month: 5, year: academicYearEnd },     // май
                { month: 6, year: academicYearEnd }      // июнь
            ];

            // ============================================================
            // ШАГ 2: ОБРАБОТКА КАЖДОГО МЕСЯЦА УЧЕБНОГО ГОДА
            // ============================================================

            // Обрабатываем каждый месяц учебного года
            for (const monthData of academicMonths) {
                console.log(`\n${'='.repeat(60)}`);
                console.log(`📅 Обрабатываем месяц: ${monthData.month}/${monthData.year}`);
                console.log(`${'='.repeat(60)}`);

                try {
                    // Проверяем, есть ли результаты за этот месяц
                    const resultsCount = await StudentResult.countDocuments({ 
                        month: monthData.month, 
                        year: monthData.year 
                    });

                    if (resultsCount === 0) {
                        console.log(`⚠️ Нет результатов за ${monthData.month}/${monthData.year}, пропускаем...`);
                        continue;
                    }

                    console.log(`📊 Найдено ${resultsCount} результатов за ${monthData.month}/${monthData.year}`);

                    // Вызываем функцию обновления статистики для конкретного месяца
                    await this.updateStatsForMonth(monthData.month, monthData.year);

                    console.log(`✅ Месяц ${monthData.month}/${monthData.year} обработан успешно`);
                } catch (error) {
                    console.error(`❌ Ошибка при обработке месяца ${monthData.month}/${monthData.year}:`, error);
                    // Продолжаем обработку других месяцев
                }
            }

            console.log(`\n${'='.repeat(60)}`);
            console.log("🏁 Обработка всех месяцев завершена");
            console.log(`${'='.repeat(60)}\n`);

            // ============================================================
            // ШАГ 3: ФИНАЛЬНЫЕ ПОДСЧЁТЫ
            // ============================================================

            // После обработки всех месяцев обновляем статистику районов, школ и учителей
            console.log("🔢 Подсчитываем общий score для всех студентов...");
            await this.updateStudentScores();

            console.log("🏆 Обновляем рейтинг студентов (place)...");
            await this.updateStudentPlaces();

            console.log("� Сохраняем рейтинги студентов за текущий учебный год...");
            await this.saveStudentRatingsSnapshot(academicYearStart);

            console.log("�👨‍🏫 Обновляем статистику учителей...");
            await this.updateTeacherScores();
            await this.updateTeacherRankings();

            console.log("🏫 Обновляем статистику школ...");
            await this.updateSchoolScores();
            await this.updateSchoolRankings();

            console.log("🏛️ Обновляем статистику районов...");
            await this.updateDistrictScores();
            await this.updateDistrictRankings();

            console.log("\n✅ Полное обновление статистики за учебный год завершено!");
            this.cache.clear();
            return 200;

        } catch (error) {
            console.error("❌ Ошибка при полном обновлении статистики:", error);
            throw error;
        }
    }

    /**
     * Обновляет статистику для конкретного месяца
     * Это вспомогательная функция, которая выполняет ту же логику, что и updateStats(),
     * но для указанного месяца, а не текущего
     */
    private async updateStatsForMonth(month: number, year: number): Promise<void> {
        try {
            // Шаг 1: Получаем все результаты студентов за указанный месяц
            const studentResults = await StudentResult.find({ 
                month: month, 
                year: year 
            }).populate({
                path: 'student',
                populate: {
                    path: 'district'
                }
            });

            if (studentResults.length === 0) {
                console.log(`⚠️ Нет результатов за ${month}/${year}`);
                return;
            }

            // Шаг 2: Группируем по классам (grade) и районам (district)
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

            // Шаг 3: Находим лучших студентов в каждом классе и районе
            const districtTopStudentUpdates: any[] = [];
            
            for (const [gradeDistrictKey, results] of gradeDistrictGroups.entries()) {
                const [grade, districtId] = gradeDistrictKey.split('-');
                
                const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                
                if (liceyStudentsWithMaxScore.length > 0) {
                    for (const student of liceyStudentsWithMaxScore) {
                        districtTopStudentUpdates.push({
                            updateOne: {
                                filter: { _id: student._id },
                                update: { $set: { studentOfTheMonthScore: 5 } }
                            }
                        });
                    }
                }
            }

            // Применяем обновления для студентов месяца по районам
            if (districtTopStudentUpdates.length > 0) {
                await StudentResult.bulkWrite(districtTopStudentUpdates);
                console.log(`✅ Обновлено ${districtTopStudentUpdates.length} студентов месяца по районам`);
            }

            // Шаг 4: Находим лучших студентов в каждом классе по всей республике
            const republicTopStudentUpdates: any[] = [];
            
            for (const [grade, results] of gradeGroups.entries()) {
                const maxTotalScore = Math.max(...results.map(r => r.totalScore));
                const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
                const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => this.isLiceyLevel(r.level));
                
                if (liceyStudentsWithMaxScore.length > 0) {
                    for (const student of liceyStudentsWithMaxScore) {
                        republicTopStudentUpdates.push({
                            updateOne: {
                                filter: { _id: student._id },
                                update: { $set: { republicWideStudentOfTheMonthScore: 5 } }
                            }
                        });
                    }
                }
            }

            // Применяем обновления для студентов месяца по республике
            if (republicTopStudentUpdates.length > 0) {
                await StudentResult.bulkWrite(republicTopStudentUpdates);
                console.log(`✅ Обновлено ${republicTopStudentUpdates.length} студентов месяца по республике`);
            }

            // Шаг 5: Находим развивающихся студентов за этот месяц
            await studentResultService.markDevelopingStudents(month, year);

        } catch (error) {
            console.error(`❌ Ошибка при обновлении статистики для месяца ${month}/${year}:`, error);
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

            // Шаг 6: Подсчитываем общий score для всех студентов
            console.log("🔢 Подсчитываем общий score для студентов...");
            await this.updateStudentScores();

            // Шаг 7: Обновляем место в рейтинге (place) для всех студентов
            console.log("🏆 Обновляем рейтинг студентов (place)...");
            await this.updateStudentPlaces();

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
        const studentResults = await StudentResult.aggregate(pipeline).collation({ locale: 'az', strength: 2 });
        
        // Используем числовые поля вместо поиска в статусе
        const studentsOfMonth = studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
        const studentsOfMonthByRepublic = studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
        const developingStudents = studentResults.filter(r => r.developmentScore && r.developmentScore > 0);

        return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
    }

    // Отдельный метод для получения развивающихся студентов
    async getDevelopingStudents(filters: StatisticsFilter): Promise<IStudentResult[]> {
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
        
        // Add level numeric value for sorting
        pipeline.push({
            $addFields: {
                levelValue: {
                    $switch: {
                        branches: [
                            { case: { $eq: ['$level', 'E'] }, then: 1 },
                            { case: { $eq: ['$level', 'D'] }, then: 2 },
                            { case: { $eq: ['$level', 'C'] }, then: 3 },
                            { case: { $eq: ['$level', 'B'] }, then: 4 },
                            { case: { $eq: ['$level', 'A'] }, then: 5 },
                            { case: { $eq: ['$level', 'Lisey'] }, then: 6 }
                        ],
                        default: 0
                    }
                }
            }
        });
        
        // Add sorting
        if (filters.sortColumn && filters.sortDirection) {
            const sortOptions: any = {};
            const sortDirection = filters.sortDirection === 'asc' ? 1 : -1;
            
            // Map column names to actual field paths
            if (filters.sortColumn === 'level') {
                sortOptions.levelValue = sortDirection;
            } else if (filters.sortColumn === 'code') {
                sortOptions['studentData.code'] = sortDirection;
            } else if (filters.sortColumn === 'lastName') {
                sortOptions['studentData.lastName'] = sortDirection;
            } else if (filters.sortColumn === 'firstName') {
                sortOptions['studentData.firstName'] = sortDirection;
            } else if (filters.sortColumn === 'middleName') {
                sortOptions['studentData.middleName'] = sortDirection;
            } else if (filters.sortColumn === 'grade') {
                sortOptions['studentData.grade'] = sortDirection;
            } else if (filters.sortColumn === 'teacher') {
                sortOptions['studentData.teacher.fullname'] = sortDirection;
            } else if (filters.sortColumn === 'school') {
                sortOptions['studentData.school.name'] = sortDirection;
            } else if (filters.sortColumn === 'district') {
                sortOptions['studentData.district.name'] = sortDirection;
            } else if (filters.sortColumn === 'totalScore') {
                sortOptions.totalScore = sortDirection;
            } else if (filters.sortColumn === 'averageScore') {
                sortOptions['studentData.averageScore'] = sortDirection;
            } else if (filters.sortColumn.startsWith('studentData.')) {
                sortOptions[filters.sortColumn] = sortDirection;
            } else {
                sortOptions[filters.sortColumn] = sortDirection;
            }
            
            pipeline.push({ $sort: sortOptions });
        }
        
        const studentResults = await StudentResult.aggregate(pipeline).collation({ locale: 'az', strength: 2 });
        
        // Фильтруем только развивающихся студентов
        return studentResults.filter(r => r.developmentScore && r.developmentScore > 0);
    }

    // Отдельный метод для получения студентов месяца
    async getStudentsOfMonth(filters: StatisticsFilter): Promise<IStudentResult[]> {
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
        
        // Add sorting
        if (filters.sortColumn && filters.sortDirection) {
            const sortOptions: any = {};
            const sortDirection = filters.sortDirection === 'asc' ? 1 : -1;
            
            // Map column names to actual field paths
            if (filters.sortColumn === 'code') {
                sortOptions['studentData.code'] = sortDirection;
            } else if (filters.sortColumn === 'lastName') {
                sortOptions['studentData.lastName'] = sortDirection;
            } else if (filters.sortColumn === 'firstName') {
                sortOptions['studentData.firstName'] = sortDirection;
            } else if (filters.sortColumn === 'middleName') {
                sortOptions['studentData.middleName'] = sortDirection;
            } else if (filters.sortColumn === 'grade') {
                sortOptions['studentData.grade'] = sortDirection;
            } else if (filters.sortColumn === 'teacher') {
                sortOptions['studentData.teacher.fullname'] = sortDirection;
            } else if (filters.sortColumn === 'school') {
                sortOptions['studentData.school.name'] = sortDirection;
            } else if (filters.sortColumn === 'district') {
                sortOptions['studentData.district.name'] = sortDirection;
            } else if (filters.sortColumn === 'totalScore') {
                sortOptions.totalScore = sortDirection;
            } else if (filters.sortColumn === 'averageScore') {
                sortOptions['studentData.averageScore'] = sortDirection;
            } else if (filters.sortColumn.startsWith('studentData.')) {
                sortOptions[filters.sortColumn] = sortDirection;
            } else {
                sortOptions[filters.sortColumn] = sortDirection;
            }
            
            pipeline.push({ $sort: sortOptions });
        }
        
        const studentResults = await StudentResult.aggregate(pipeline).collation({ locale: 'az', strength: 2 });
        
        // Фильтруем только студентов месяца (по районам)
        return studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
    }

    // Отдельный метод для получения студентов месяца по республике
    async getStudentsOfMonthByRepublic(filters: StatisticsFilter): Promise<IStudentResult[]> {
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
        
        // Add sorting
        if (filters.sortColumn && filters.sortDirection) {
            const sortOptions: any = {};
            const sortDirection = filters.sortDirection === 'asc' ? 1 : -1;
            
            // Map column names to actual field paths
            if (filters.sortColumn === 'code') {
                sortOptions['studentData.code'] = sortDirection;
            } else if (filters.sortColumn === 'lastName') {
                sortOptions['studentData.lastName'] = sortDirection;
            } else if (filters.sortColumn === 'firstName') {
                sortOptions['studentData.firstName'] = sortDirection;
            } else if (filters.sortColumn === 'middleName') {
                sortOptions['studentData.middleName'] = sortDirection;
            } else if (filters.sortColumn === 'grade') {
                sortOptions['studentData.grade'] = sortDirection;
            } else if (filters.sortColumn === 'teacher') {
                sortOptions['studentData.teacher.fullname'] = sortDirection;
            } else if (filters.sortColumn === 'school') {
                sortOptions['studentData.school.name'] = sortDirection;
            } else if (filters.sortColumn === 'district') {
                sortOptions['studentData.district.name'] = sortDirection;
            } else if (filters.sortColumn === 'totalScore') {
                sortOptions.totalScore = sortDirection;
            } else if (filters.sortColumn === 'averageScore') {
                sortOptions['studentData.averageScore'] = sortDirection;
            } else if (filters.sortColumn.startsWith('studentData.')) {
                sortOptions[filters.sortColumn] = sortDirection;
            } else {
                sortOptions[filters.sortColumn] = sortDirection;
            }
            
            pipeline.push({ $sort: sortOptions });
        }
        
        const studentResults = await StudentResult.aggregate(pipeline).collation({ locale: 'az', strength: 2 });
        
        // Фильтруем только студентов месяца по республике
        return studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
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

        // Используем числовые поля вместо поиска в статусе
        const studentsOfMonth = studentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
        const studentsOfMonthByRepublic = studentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
        const developingStudents = studentResults.filter(r => r.developmentScore && r.developmentScore > 0);

        return { studentsOfMonth, studentsOfMonthByRepublic, developingStudents };
    }

    async getTeacherStatistics(
        filters: FilterOptions & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: ITeacher[], totalCount: number }> {
        const cacheKey = `teacher::${JSON.stringify(filters)}::${sortColumn}::${sortDirection}`;
        const cached = this.cache.get<{ data: ITeacher[], totalCount: number }>(cacheKey);
        if (cached) return cached;

        const filter: any = { active: true };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        
        const page = filters.page || 1;
        const size = filters.size || 100;
        const skip = (page - 1) * size;

        // Получаем ВСЕ данные для расчета мест
        const currentYear = getCurrentAcademicYear();
        const allData: any[] = await Teacher
            .find(filter)
            .collation({ locale: 'az', strength: 2 })
            .populate("district")
            .populate("school")
            .populate({ path: "school", populate: { path: "district", model: "District" } })
            .lean();

        // Проецируем баллы текущего учебного года в корень объекта
        this.flattenCurrentYearRating(allData, currentYear);

        // Расчитываем места по тому же полю, по которому сортируем
        assignPlaces(allData, sortColumn as 'averageScore' | 'score');

        // Применяем пагинацию
        const paginatedData = allData.slice(skip, skip + size);

        // Добавляем значения по умолчанию для отсутствующих полей
        paginatedData.forEach((teacher: any) => {
            if (teacher.studentCount === undefined || teacher.studentCount === null) {
                teacher.studentCount = 0;
            }
        });

        const totalCount = await Teacher.countDocuments(filter);

        const result = { data: paginatedData as unknown as ITeacher[], totalCount };
        this.cache.set(cacheKey, result);
        return result;
    }

    async getSchoolStatistics(
        filters: FilterOptions & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: ISchool[], totalCount: number }> {
        const cacheKey = `school::${JSON.stringify(filters)}::${sortColumn}::${sortDirection}`;
        const cached = this.cache.get<{ data: ISchool[], totalCount: number }>(cacheKey);
        if (cached) return cached;

        const filter: any = { active: true };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const page = filters.page || 1;
        const size = filters.size || 100;
        const skip = (page - 1) * size;

        // Получаем ВСЕ данные для расчета мест
        const currentYear = getCurrentAcademicYear();
        const allData: any[] = await School
            .find(filter)
            .collation({ locale: 'az', strength: 2 })
            .populate("district")
            .lean();

        // Проецируем баллы текущего учебного года в корень объекта
        this.flattenCurrentYearRating(allData, currentYear);

        // Расчитываем места по тому же полю, по которому сортируем
        assignPlaces(allData, sortColumn as 'averageScore' | 'score');

        // Применяем пагинацию
        const paginatedData = allData.slice(skip, skip + size);

        // Добавляем значения по умолчанию для отсутствующих полей
        paginatedData.forEach((school: any) => {
            if (school.studentCount === undefined || school.studentCount === null) {
                school.studentCount = 0;
            }
        });

        const totalCount = await School.countDocuments(filter);

        const result = { data: paginatedData as unknown as ISchool[], totalCount };
        this.cache.set(cacheKey, result);
        return result;
    }

    async getDistrictStatistics(
        filters: FilterOptions & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: IDistrict[], totalCount: number }> {
        const cacheKey = `district::${JSON.stringify(filters)}::${sortColumn}::${sortDirection}`;
        const cached = this.cache.get<{ data: IDistrict[], totalCount: number }>(cacheKey);
        if (cached) return cached;

        const filter: any = {};

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            filter.code = { $gte: start, $lte: end };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const page = filters.page || 1;
        const size = filters.size || 100;
        const skip = (page - 1) * size;

        // Получаем ВСЕ данные для расчета мест
        const currentYear = getCurrentAcademicYear();
        const allData: any[] = await District
            .find(filter)
            .collation({ locale: 'az', strength: 2 })
            .lean();

        // Проецируем баллы текущего учебного года в корень объекта
        this.flattenCurrentYearRating(allData, currentYear);

        // Расчитываем места по тому же полю, по которому сортируем
        assignPlaces(allData, sortColumn as 'averageScore' | 'score');

        // Применяем пагинацию
        const paginatedData = allData.slice(skip, skip + size);

        // Добавляем значения по умолчанию для отсутствующих полей
        paginatedData.forEach((district: any) => {
            if (district.studentCount === undefined || district.studentCount === null) {
                district.studentCount = 0;
            }
        });

        const totalCount = await District.countDocuments(filter);

        const result = { data: paginatedData as unknown as IDistrict[], totalCount };
        this.cache.set(cacheKey, result);
        return result;
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

    /**
     * Обновляет общий score для всех студентов на основе их результатов
     */
    private async updateStudentScores(): Promise<void> {
        try {
            // Определяем диапазон месяцев текущего учебного года
            const academicYear = getCurrentAcademicYear();
            const academicYearEnd = academicYear + 1;

            // Агрегация для подсчета общего score каждого студента
            // Только за текущий учебный год (сентябрь-декабрь academicYear + январь-июнь academicYear+1)
            const pipeline = [
                {
                    $match: {
                        $or: [
                            { month: { $in: [9, 10, 11, 12] }, year: academicYear },
                            { month: { $in: [1, 2, 3, 4, 5, 6] }, year: academicYearEnd }
                        ]
                    }
                },
                {
                    $group: {
                        _id: '$student',
                        totalParticipationScore: { 
                            $sum: { $ifNull: ['$participationScore', 0] }
                        },
                        totalDevelopmentScore: { 
                            $sum: { $ifNull: ['$developmentScore', 0] }
                        },
                        totalStudentOfTheMonthScore: { 
                            $sum: { $ifNull: ['$studentOfTheMonthScore', 0] }
                        },
                        totalRepublicWideStudentOfTheMonthScore: { 
                            $sum: { $ifNull: ['$republicWideStudentOfTheMonthScore', 0] }
                        }
                    }
                },
                {
                    $addFields: {
                        totalScore: {
                            $add: [
                                '$totalParticipationScore',
                                '$totalDevelopmentScore', 
                                '$totalStudentOfTheMonthScore',
                                '$totalRepublicWideStudentOfTheMonthScore'
                            ]
                        }
                    }
                }
            ];

            const studentScores = await StudentResult.aggregate(pipeline);
            
            if (studentScores.length === 0) {
                console.log("Нет результатов для подсчета score студентов.");
                return;
            }

            // Подготавливаем bulk операции для обновления студентов
            const bulkOperations = studentScores.map(scoreData => ({
                updateOne: {
                    filter: { _id: scoreData._id },
                    update: { 
                        $set: { 
                            score: scoreData.totalScore,
                            participationScore: scoreData.totalParticipationScore,
                            developmentScore: scoreData.totalDevelopmentScore,
                            studentOfTheMonthScore: scoreData.totalStudentOfTheMonthScore,
                            republicWideStudentOfTheMonthScore: scoreData.totalRepublicWideStudentOfTheMonthScore
                        } 
                    }
                }
            }));

            // Выполняем массовое обновление студентов
            if (bulkOperations.length > 0) {
                await Student.bulkWrite(bulkOperations);
                console.log(`✅ Обновлен общий score для ${bulkOperations.length} студентов`);
                
                // Показываем статистику по баллам
                const totalScoreSum = studentScores.reduce((sum, student) => sum + student.totalScore, 0);
                const averageScore = totalScoreSum / studentScores.length;
                console.log(`📊 Общая сумма баллов: ${totalScoreSum}, средний балл: ${averageScore.toFixed(2)}`);
            }

        } catch (error) {
            console.error("❌ Ошибка при обновлении score студентов:", error);
            throw error;
        }
    }

    /**
     * Обновляет место в рейтинге (place) для всех студентов на основе их score
     */
    private async updateStudentPlaces(): Promise<void> {
        try {
            // Получаем всех студентов, отсортированных по score в убывающем порядке
            const students = await Student.find({ score: { $exists: true } })
                                         .sort({ score: -1, code: 1 }) // сортируем по score убывание, при равенстве по коду
                                         .select('_id score');

            if (students.length === 0) {
                console.log("Нет студентов с score для установки места в рейтинге.");
                return;
            }

            // Подготавливаем bulk операции для обновления места
            const bulkOperations = [];
            let currentPlace = 1;
            let previousScore = 0;

            for (let i = 0; i < students.length; i++) {
                const student = students[i];
                
                // Если это первый студент или балл изменился
                if (student.score < previousScore) {
                    // Место = позиция в отсортированном списке + 1
                    currentPlace++;
                }
                // Если балл такой же, как у предыдущего, место остается тем же

                bulkOperations.push({
                    updateOne: {
                        filter: { _id: student._id },
                        update: { $set: { place: currentPlace } }
                    }
                });

                previousScore = student.score;
            }

            // Выполняем массовое обновление мест
            if (bulkOperations.length > 0) {
                await Student.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} студентов`);
                
                // Показываем статистику рейтинга
                const topStudent = students[0];
                const lastStudent = students[students.length - 1];
                console.log(`🥇 Лидер рейтинга: ${topStudent.score} баллов (место 1)`);
                console.log(`📊 Всего в рейтинге: ${students.length} студентов`);
                console.log(`🔢 Диапазон баллов: ${lastStudent.score} - ${topStudent.score}`);
            }

        } catch (error) {
            console.error("❌ Ошибка при обновлении места в рейтинге:", error);
            throw error;
        }
    }

    /**
     * Сохраняет снапшот flat-полей студентов (score, averageScore, place) в ratings[]
     * под ключом academicYearStart. Вызывается после updateStudentPlaces().
     */
    private async saveStudentRatingsSnapshot(academicYearStart: number): Promise<void> {
        try {
            await Student.updateMany({}, [{
                $set: {
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", academicYearStart] } } },
                            [{ year: academicYearStart, score: "$score", averageScore: "$averageScore", place: "$place" }]
                        ]
                    }
                }
            }] as any);
            console.log(`✅ Snapshot рейтинга студентов сохранён для учебного года ${academicYearStart}`);
        } catch (error) {
            console.error("❌ Ошибка при сохранении snapshot рейтинга студентов:", error);
            throw error;
        }
    }

    /**
     * Обновляем общий score для всех учителей
     */
    private async updateTeacherScores(): Promise<void> {
        // Реализация обновления score для учителей: баллы учителя это сумма баллов его студентов
        try {
            const pipeline = [
                {
                    $lookup: {
                        from: 'students',
                        localField: '_id',
                        foreignField: 'teacher',
                        as: 'students'
                    }
                },
                {
                    $project: {
                        _id: 1,
                        totalScore: { $sum: '$students.score' },
                        studentCount: 1  // Используем существующее поле studentCount
                    }
                },
                {
                    $addFields: {
                        averageScore: {
                            $cond: {
                                if: { $gt: ['$studentCount', 0] },
                                then: { $divide: ['$totalScore', '$studentCount'] },
                                else: 0
                            }
                        }
                    }
                }
            ];

            const teacherScores = await Teacher.aggregate(pipeline);

            const currentYear = getCurrentAcademicYear();
            const bulkOperations = teacherScores.map((teacher: any) => ({
                updateOne: {
                    filter: { _id: teacher._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                                    [{ year: currentYear, score: teacher.totalScore, averageScore: teacher.averageScore, place: null }]
                                ]
                            }
                        }
                    }]
                }
            }));

            if (bulkOperations.length > 0) {
                await Teacher.bulkWrite(bulkOperations as any);
                console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} учителей`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении баллов учителей:", error);
            throw error;
        }
    }

    private async updateTeacherRankings(): Promise<void> {
        try {
            const currentYear = getCurrentAcademicYear();
            // Получаем всех учителей с рейтингами
            const teachers = await Teacher.find().select('_id ratings code').lean();

            // Проецируем балл текущего года
            const teachersWithScore = teachers.map((t: any) => ({
                _id: t._id,
                currentScore: ((t.ratings || []).find((r: any) => r.year === currentYear) as any)?.score ?? 0,
                code: t.code
            }));

            // Сортируем по баллу убывание, по коду возрастание
            teachersWithScore.sort((a, b) => {
                if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
                return (a.code ?? 0) - (b.code ?? 0);
            });

            if (teachersWithScore.length === 0) {
                console.log("Нет учителей для установки места в рейтинге.");
                return;
            }

            const bulkOperations: any[] = [];
            let currentPlace = 1;
            let previousScore = teachersWithScore[0].currentScore;

            for (let i = 0; i < teachersWithScore.length; i++) {
                const teacher = teachersWithScore[i];
                if (teacher.currentScore < previousScore) {
                    currentPlace = i + 1;
                }
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: teacher._id },
                        update: [{
                            $set: {
                                ratings: {
                                    $map: {
                                        input: { $ifNull: ["$ratings", []] },
                                        as: "r",
                                        in: {
                                            $cond: {
                                                if: { $eq: ["$$r.year", currentYear] },
                                                then: { $mergeObjects: ["$$r", { place: currentPlace }] },
                                                else: "$$r"
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                });
                previousScore = teacher.currentScore;
            }

            if (bulkOperations.length > 0) {
                await Teacher.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} учителей`);
                const top = teachersWithScore[0];
                const last = teachersWithScore[teachersWithScore.length - 1];
                console.log(`🥇 Лидер рейтинга учителей: ${top.currentScore} баллов (место 1)`);
                console.log(`📊 Всего в рейтинге: ${teachersWithScore.length} учителей`);
                console.log(`🔢 Диапазон баллов: ${last.currentScore} - ${top.currentScore}`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении места в рейтинге учителей:", error);
            throw error;
        }
    }

    /**
     * Обновляем общий score для всех школ
     */
    private async updateSchoolScores(): Promise<void> {
        // Баллы школы = сумма баллов учителей за текущий учебный год
        try {
            const currentYear = getCurrentAcademicYear();
            const pipeline = [
                {
                    $addFields: {
                        currentScore: {
                            $let: {
                                vars: {
                                    yr: { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$ratings", []] }, cond: { $eq: ["$$this.year", currentYear] } } }, 0] }
                                },
                                in: { $ifNull: ["$$yr.score", 0] }
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: "$school",
                        totalScore: { $sum: "$currentScore" }
                    }
                },
                {
                    $lookup: {
                        from: 'schools',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'schoolData'
                    }
                },
                {
                    $unwind: '$schoolData'
                },
                {
                    $addFields: {
                        averageScore: {
                            $cond: {
                                if: { $gt: ['$schoolData.studentCount', 0] },
                                then: { $divide: ['$totalScore', '$schoolData.studentCount'] },
                                else: 0
                            }
                        }
                    }
                }
            ];

            const schoolScores = await Teacher.aggregate(pipeline).exec();

            const bulkOperations = schoolScores.map((schoolScore: any) => ({
                updateOne: {
                    filter: { _id: schoolScore._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                                    [{ year: currentYear, score: schoolScore.totalScore, averageScore: schoolScore.averageScore, place: null }]
                                ]
                            }
                        }
                    }]
                }
            }));

            if (bulkOperations.length > 0) {
                await School.bulkWrite(bulkOperations as any);
                console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} школ`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении баллов школ:", error);
            throw error;
        }
    }

    private async updateSchoolRankings(): Promise<void> {
        try {
            const currentYear = getCurrentAcademicYear();
            const schools = await School.find().select('_id ratings code').lean();

            const schoolsWithScore = schools.map((s: any) => ({
                _id: s._id,
                currentScore: ((s.ratings || []).find((r: any) => r.year === currentYear) as any)?.score ?? 0,
                code: s.code
            }));

            schoolsWithScore.sort((a, b) => {
                if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
                return (a.code ?? 0) - (b.code ?? 0);
            });

            if (schoolsWithScore.length === 0) {
                console.log("Нет школ для установки места в рейтинге.");
                return;
            }

            const bulkOperations: any[] = [];
            let currentPlace = 1;
            let previousScore = schoolsWithScore[0].currentScore;

            for (let i = 0; i < schoolsWithScore.length; i++) {
                const school = schoolsWithScore[i];
                if (school.currentScore < previousScore) {
                    currentPlace = i + 1;
                }
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: school._id },
                        update: [{
                            $set: {
                                ratings: {
                                    $map: {
                                        input: { $ifNull: ["$ratings", []] },
                                        as: "r",
                                        in: {
                                            $cond: {
                                                if: { $eq: ["$$r.year", currentYear] },
                                                then: { $mergeObjects: ["$$r", { place: currentPlace }] },
                                                else: "$$r"
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                });
                previousScore = school.currentScore;
            }

            if (bulkOperations.length > 0) {
                await School.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} школ`);
                const top = schoolsWithScore[0];
                const last = schoolsWithScore[schoolsWithScore.length - 1];
                console.log(`🥇 Лидер рейтинга школ: ${top.currentScore} баллов (место 1)`);
                console.log(`📊 Всего в рейтинге: ${schoolsWithScore.length} школ`);
                console.log(`🔢 Диапазон баллов: ${last.currentScore} - ${top.currentScore}`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении рейтинга школ:", error);
            throw error;
        }
    }

    /**
     * Обновляет общий score для всех районов
     */
    private async updateDistrictScores(): Promise<void> {
        // Баллы района = сумма баллов школ за текущий учебный год
        try {
            const currentYear = getCurrentAcademicYear();
            const pipeline = [
                {
                    $addFields: {
                        currentScore: {
                            $let: {
                                vars: {
                                    yr: { $arrayElemAt: [{ $filter: { input: { $ifNull: ["$ratings", []] }, cond: { $eq: ["$$this.year", currentYear] } } }, 0] }
                                },
                                in: { $ifNull: ["$$yr.score", 0] }
                            }
                        }
                    }
                },
                {
                    $lookup: {
                        from: 'students',
                        localField: 'district',
                        foreignField: 'district',
                        as: 'students'
                    }
                },
                {
                    $group: {
                        _id: "$district",
                        totalScore: { $sum: "$currentScore" },
                        studentCount: { $sum: { $size: "$students" } }
                    }
                },
                {
                    $addFields: {
                        averageScore: {
                            $cond: {
                                if: { $gt: ['$studentCount', 0] },
                                then: { $divide: ['$totalScore', '$studentCount'] },
                                else: 0
                            }
                        }
                    }
                }
            ];
            const districtScores = await School.aggregate(pipeline).exec();

            const bulkOperations = districtScores.map((districtScore: any) => ({
                updateOne: {
                    filter: { _id: districtScore._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                                    [{ year: currentYear, score: districtScore.totalScore, averageScore: districtScore.averageScore, place: null }]
                                ]
                            }
                        }
                    }]
                }
            }));
            if (bulkOperations.length > 0) {
                await District.bulkWrite(bulkOperations as any);
                console.log(`✅ Обновлено score и averageScore для ${bulkOperations.length} районов`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении баллов районов:", error);
            throw error;
        }
    }
    
    private async updateDistrictRankings(): Promise<void> {
        try {
            const currentYear = getCurrentAcademicYear();
            const districts = await District.find().select('_id ratings code').lean();

            const districtsWithScore = districts.map((d: any) => ({
                _id: d._id,
                currentScore: ((d.ratings || []).find((r: any) => r.year === currentYear) as any)?.score ?? 0,
                code: d.code
            }));

            districtsWithScore.sort((a, b) => {
                if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
                return (a.code ?? 0) - (b.code ?? 0);
            });

            if (districtsWithScore.length === 0) {
                console.log("Нет районов для установки места в рейтинге.");
                return;
            }

            const bulkOperations: any[] = [];
            let currentPlace = 1;
            let previousScore = districtsWithScore[0].currentScore;

            for (let i = 0; i < districtsWithScore.length; i++) {
                const district = districtsWithScore[i];
                if (district.currentScore < previousScore) {
                    currentPlace = i + 1;
                }
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: district._id },
                        update: [{
                            $set: {
                                ratings: {
                                    $map: {
                                        input: { $ifNull: ["$ratings", []] },
                                        as: "r",
                                        in: {
                                            $cond: {
                                                if: { $eq: ["$$r.year", currentYear] },
                                                then: { $mergeObjects: ["$$r", { place: currentPlace }] },
                                                else: "$$r"
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                });
                previousScore = district.currentScore;
            }

            if (bulkOperations.length > 0) {
                await District.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} районов`);
                const top = districtsWithScore[0];
                const last = districtsWithScore[districtsWithScore.length - 1];
                console.log(`🥇 Лидер рейтинга районов: ${top.currentScore} баллов (место 1)`);
                console.log(`📊 Всего в рейтинге: ${districtsWithScore.length} районов`);
                console.log(`🔢 Диапазон баллов: ${last.currentScore} - ${top.currentScore}`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении рейтинга районов:", error);
            throw error;
        }
    }
}

// Legacy function exports for backward compatibility
const statsService = new StatsService();

export const resetStats = () => statsService.resetStats();
export const updateStats = () => statsService.updateStats();
export const updateAllStats = () => statsService.updateAllStats();
