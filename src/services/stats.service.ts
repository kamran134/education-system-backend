import Exam, { IExam } from "../models/exam.model";
import District from "../models/district.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";
import { IStudent } from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { markDevelopingStudents, markTopStudents, markTopStudentsRepublic } from "./studentResult.service";

export const resetStats = async (): Promise<void> => {
    try {
        await StudentResult.updateMany({ status: "", score: 1 });
    } catch (error) {
        console.error(error);
    }
}

export const updateStats = async (): Promise<number> => {
    try {
        // Сначала сбрасываем всю статистику
        await resetStats();
        
        // Получаем все даты экзаменов (только поле date)
        const exams: IExam[] = await Exam.find({}, { date: 1 });

        if (!exams.length) {
            console.log("Нет экзаменов в базе.");
            return 404;
        }

        // Создаём Set для хранения уникальных (год, месяц)
        const uniqueMonths = new Set<string>();

        for (const exam of exams) {
            const date = new Date(exam.date);
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // Январь — 1, Февраль — 2 и т. д.
            uniqueMonths.add(`${year}-${month}`);
        }

        // Преобразуем в массив и сортируем по дате (по возрастанию)
        const sortedMonths = Array.from(uniqueMonths)
            .map(m => {
                const [year, month] = m.split("-").map(Number);
                return { year, month };
            })
            .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

        console.log(`Будет обработано ${sortedMonths.length} месяцев...`);
        await markDevelopingStudents(new Date().getMonth(), new Date().getFullYear());
        // Вызываем `markTopStudents()` для каждого месяца
        for (const { year, month } of sortedMonths) {
            console.log(`🔹 Обрабатываем ${month}/${year}...`);
            //await markDevelopingStudents(month, year);
            await markTopStudents(month, year);
            await markTopStudentsRepublic(month, year);
        }

        console.log("✅ Обработка всех месяцев завершена.");

        await calculateAndSaveScores();

        return 200;
    } catch (error) {
        throw error;
    }
}

export const calculateAndSaveScores = async () => {
    try {
        const results = await StudentResult.find().populate('student');
        
        const districtScores = new Map<string, number[]>();
        const schoolScores = new Map<string, number[]>();
        const teacherScores = new Map<string, number[]>();

        for (const result of results) {
            const student = result.student as IStudent;
            if (!student) continue;

            const { district, school, teacher } = student;
            const score = result.score;

            if (district) {
                if (!districtScores.has(district.toString())) {
                    districtScores.set(district.toString(), []);
                }
                districtScores.get(district.toString())!.push(score);
            }
            if (school) {
                if (!schoolScores.has(school.toString())) {
                    schoolScores.set(school.toString(), []);
                }
                schoolScores.get(school.toString())!.push(score);
            }
            if (teacher) {
                if (!teacherScores.has(teacher.toString())) {
                    teacherScores.set(teacher.toString(), []);
                }
                teacherScores.get(teacher.toString())!.push(score);
            }
        }

        // Обновление данных в базе
        await Promise.all([
            ...[...districtScores.entries()].map(([districtId, scores]) => {
                const totalScore = scores.reduce((acc, item) => acc + item, 0);
                return District.findByIdAndUpdate(districtId, {
                    score: totalScore,
                    averageScore: totalScore / scores.length
                }, { new: true });
            }),
            ...[...schoolScores.entries()].map(([schoolId, scores]) => {
                const totalScore = scores.reduce((acc, item) => acc + item, 0);
                return School.findByIdAndUpdate(schoolId, {
                    score: totalScore,
                    averageScore: totalScore / scores.length
                }, { new: true });
            }),
            ...[...teacherScores.entries()].map(([teacherId, scores]) => {
                const totalScore = scores.reduce((acc, item) => acc + item, 0);
                return Teacher.findByIdAndUpdate(teacherId, {
                    score: totalScore,
                    averageScore: totalScore / scores.length
                }, { new: true });
            })
        ]);                

        console.log('Scores updated successfully');
    } catch (error) {
        console.error('Error updating scores:', error);
    }
}

const groupBy = (arr: any[], key: string) => {
    return arr.reduce((acc, item) => {
        (acc[item[key]] = acc[item[key]] || []).push(item);
        return acc;
    }, {});
}