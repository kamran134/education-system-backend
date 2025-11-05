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
            // ШАГ 1: ОБНУЛЕНИЕ ВСЕХ БАЛЛОВ И СТАТИСТИКИ
            // ============================================================
            console.log("\n🔄 Обнуляем все баллы и статистику...");
            
            // Обнуляем баллы студентов
            console.log("👨‍🎓 Обнуляем баллы студентов...");
            await Student.updateMany(
                {},
                { 
                    $set: { 
                        score: 0,
                        averageScore: 0,
                        participationScore: 0,
                        developmentScore: 0,
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0,
                        place: null,
                        status: ''
                    }
                }
            );
            console.log("✅ Баллы студентов обнулены");

            // Обнуляем баллы учителей
            console.log("👨‍🏫 Обнуляем баллы учителей...");
            await Teacher.updateMany(
                {},
                { 
                    $set: { 
                        score: 0,
                        averageScore: 0,
                        studentCount: 0,
                        teacherOfTheYearScore: 0,
                        place: null,
                        status: ''
                    }
                }
            );
            console.log("✅ Баллы учителей обнулены");

            // Обнуляем баллы школ
            console.log("🏫 Обнуляем баллы школ...");
            await School.updateMany(
                {},
                { 
                    $set: { 
                        score: 0,
                        averageScore: 0,
                        studentCount: 0,
                        schoolOfTheYearScore: 0,
                        place: null,
                        status: ''
                    }
                }
            );
            console.log("✅ Баллы школ обнулены");

            // Обнуляем баллы районов
            console.log("🏛️ Обнуляем баллы районов...");
            await District.updateMany(
                {},
                { 
                    $set: { 
                        score: 0,
                        averageScore: 0,
                        studentCount: 0,
                        rate: 0,
                        districtOfTheYearScore: 0,
                        place: null
                    }
                }
            );
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

            // Обнуляем баллы для всех результатов учебного года
            console.log("� Обнуляем баллы студентов месяца за весь учебный год...");
            await StudentResult.updateMany(
                { 
                    $or: [
                        { year: academicYearStart, month: { $gte: 9, $lte: 12 } },
                        { year: academicYearEnd, month: { $gte: 1, $lte: 6 } }
                    ]
                },
                { 
                    $set: { 
                        studentOfTheMonthScore: 0,
                        republicWideStudentOfTheMonthScore: 0,
                        developmentScore: 0
                    }
                }
            );
            console.log("✅ Баллы результатов обнулены");

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

            // Здесь можно добавить обновление статистики для учителей, школ и районов
            // если эти методы существуют
            // console.log("👨‍🏫 Обновляем статистику учителей...");
            // await this.updateTeachersStats();

            // console.log("🏫 Обновляем статистику школ...");
            // await this.updateSchoolsStats();

            // console.log("🏛️ Обновляем статистику районов...");
            // await this.updateDistrictsStats();

            console.log("\n✅ Полное обновление статистики за учебный год завершено!");
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

            // // Шаг 6.1: Обновляем статистику для учителей, школ и районов
            // console.log("👨‍🏫 Обновляем статистику учителей...");
            // const teacherService = new TeacherService();
            // await teacherService.updateTeachersStats();

            // console.log("🏫 Обновляем статистику школ...");
            // const schoolService = new SchoolService();
            // await schoolService.updateSchoolsStats();

            // console.log("🏛️ Обновляем статистику районов...");
            // const districtService = new DistrictService();
            // await districtService.updateDistrictsStats();

            // Шаг 7: Обновляем место в рейтинге (place) для всех студентов
            console.log("🏆 Обновляем рейтинг студентов (place)...");
            await this.updateStudentPlaces();

            // // Шаг 8: Назначаем учителей года
            // console.log("👨‍🏫 Назначаем учителей года...");
            // await this.updateTeachersOfTheYear();

            // // Шаг 9: Назначаем школы года
            // console.log("🏫 Назначаем школы года...");
            // await this.updateSchoolsOfTheYear();

            // // Шаг 10: Назначаем районы года
            // console.log("🏛️ Назначаем районы года...");
            // await this.updateDistrictsOfTheYear();

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
        const studentResults = await StudentResult.aggregate(pipeline);
        
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
        const studentResults = await StudentResult.aggregate(pipeline);
        
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
        const studentResults = await StudentResult.aggregate(pipeline);
        
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
        const filter: any = { active: true };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        
        const page = filters.page || 1;
        const size = filters.size || 100;
        const skip = (page - 1) * size;

        const [data, totalCount] = await Promise.all([
            Teacher
                .find(filter)
                .populate("school")
                .populate({ path: "school", populate: { path: "district", model: "District" } })
                .sort(sortOptions)
                .skip(skip)
                .limit(size),
            Teacher.countDocuments(filter)
        ]);

        // Добавляем значения по умолчанию для отсутствующих полей
        data.forEach(teacher => {
            if (teacher.score === undefined || teacher.score === null) {
                teacher.score = 0;
            }
            if (teacher.averageScore === undefined || teacher.averageScore === null) {
                teacher.averageScore = 0;
            }
            if ((teacher as any).studentCount === undefined || (teacher as any).studentCount === null) {
                (teacher as any).studentCount = 0;
            }
            if ((teacher as any).place === undefined || (teacher as any).place === null) {
                (teacher as any).place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
            }
        });

        return { data, totalCount };
    }

    async getSchoolStatistics(
        filters: FilterOptions & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: ISchool[], totalCount: number }> {
        const filter: any = { active: true };

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const page = filters.page || 1;
        const size = filters.size || 100;
        const skip = (page - 1) * size;

        const [data, totalCount] = await Promise.all([
            School
                .find(filter)
                .populate("district")
                .sort(sortOptions)
                .skip(skip)
                .limit(size),
            School.countDocuments(filter)
        ]);

        // Добавляем значения по умолчанию для отсутствующих полей
        data.forEach(school => {
            if (school.score === undefined || school.score === null) {
                school.score = 0;
            }
            if (school.averageScore === undefined || school.averageScore === null) {
                school.averageScore = 0;
            }
            if ((school as any).studentCount === undefined || (school as any).studentCount === null) {
                (school as any).studentCount = 0;
            }
            if ((school as any).place === undefined || (school as any).place === null) {
                (school as any).place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
            }
        });

        return { data, totalCount };
    }

    async getDistrictStatistics(
        filters: FilterOptions & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: IDistrict[], totalCount: number }> {
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

        const [data, totalCount] = await Promise.all([
            District
                .find(filter)
                .sort(sortOptions)
                .skip(skip)
                .limit(size),
            District.countDocuments(filter)
        ]);

        // Добавляем значения по умолчанию для отсутствующих полей
        data.forEach(district => {
            if (district.score === undefined || district.score === null) {
                district.score = 0;
            }
            if (district.averageScore === undefined || district.averageScore === null) {
                district.averageScore = 0;
            }
            if ((district as any).studentCount === undefined || (district as any).studentCount === null) {
                (district as any).studentCount = 0;
            }
            if ((district as any).place === undefined || (district as any).place === null) {
                (district as any).place = null; // Не устанавливаем 0, т.к. место может быть не рассчитано
            }
        });

        return { data, totalCount };
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
            // Агрегация для подсчета общего score каждого студента
            const pipeline = [
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
}

// Legacy function exports for backward compatibility
const statsService = new StatsService();

export const resetStats = () => statsService.resetStats();
export const updateStats = () => statsService.updateStats();
export const updateAllStats = () => statsService.updateAllStats();
