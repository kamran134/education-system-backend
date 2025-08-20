import Exam, { IExam } from "../models/exam.model";
import District from "../models/district.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import { IStudent } from "../models/student.model";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { markAllDevelopingStudents, markDevelopingStudents, markTopStudents, markTopStudentsRepublic } from "./studentResult.service";
import { countDistrictsRates } from "./district.service";
import { Types } from "mongoose";

export const resetStats = async (): Promise<void> => {
    try {
        console.log("🔄 Сброс статистики...");
        await District.updateMany({}, { score: 0, averageScore: 0, rate: 0 });
        await StudentResult.updateMany({}, { status: "", score: 1 });
        console.log("✅ Статистика сброшена.");
    } catch (error) {
        console.error(error);
    }
}

export const updateStats = async (): Promise<number> => {
    try {
        // Сначала сбрасываем всю статистику
        await resetStats();
        await countDistrictsRates();
        
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
        // await markDevelopingStudents(new Date().getMonth(), new Date().getFullYear());
        await markAllDevelopingStudents();
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
        console.log("🔄 Обновление баллов..."); 
        // Загружаем результаты вместе со студентами, их школами, районами и учителями
         const results = await StudentResult.find().populate({
            path: 'student',
            populate: [
                { path: 'district' },
                { path: 'school', populate: { path: 'district' } },
                { path: 'teacher', populate: { path: 'school' } }
            ]
        });

        // Создаём мапы для хранения сумм баллов
        const districtScores = new Map<string, number>();
        const schoolScores = new Map<string, number>();
        const teacherScores = new Map<string, number>();
        const studentScores = new Map<string, number>();

        for (const result of results) {
            const student = result.student as IStudent;
            if (!student) continue;

            const { district, school, teacher } = student;
            const score = result.score;

            if (district && '_id' in district) {
                const districtId = (district as { _id: Types.ObjectId })._id.toString();
                districtScores.set(
                    districtId,
                    (districtScores.get(districtId) || 0) + score
                );
            }
            if (school && '_id' in school) {
                const schoolId = (school as { _id: Types.ObjectId })._id.toString();
                schoolScores.set(
                    schoolId,
                    (schoolScores.get(schoolId) || 0) + score
                );
            }
            if (teacher && '_id' in teacher) {
                const teacherId = (teacher as { _id: Types.ObjectId })._id.toString();
                teacherScores.set(
                    teacherId,
                    (teacherScores.get(teacherId) || 0) + score
                );
            }
            const studentId = (student as { _id: Types.ObjectId})._id.toString();
            studentScores.set(
                studentId,
                (studentScores.get(studentId) || 0) + score
            );
        }

        console.log("🔄 Обновление среднего балла районов, школ и учителей...");

        // Загружаем районы с их rate
        const districts: { _id: Types.ObjectId; rate: number }[] = await District.find();
        const districtRates = new Map(districts.map(d => [d._id.toString(), d.rate || 1]));

        // Обновляем данные в базе
        // Обновляем баллы для районов
        Promise.all([
            updateDistrictScores(districtRates, districtScores),
            updateSchoolScores(districtRates, schoolScores, results),
            updateTeacherScores(districtRates, teacherScores, results),
            updateStudentScores(districtRates, studentScores, results)
        ]);

        console.log("✅ Баллы обновлены.");
    } catch (error) {
        console.error('Error updating scores:', error);
    }
}

const updateDistrictScores = async (districtRates: Map<string, number>, districtScores: Map<string, number>) => {
    try {
        console.log("🔄 Обновление баллов районов...");

        // Обновляем баллы для районов
        for (const [districtId, score] of districtScores.entries()) {
            const rate = districtRates.get(districtId) || 1;

            await District.findByIdAndUpdate(districtId, {
                score,
                averageScore: score / rate
            });
        }
    } catch (error) {
        console.error('Error updating district scores:', error);
    }
}

const updateSchoolScores = async (districtRates: Map<string, number>, schoolScores: Map<string, number>, results: IStudentResult[]) => {
    try {
        console.log("🔄 Обновление баллов школ...");

        // Обновляем баллы для школ
        for (const [schoolId, score] of schoolScores.entries()) {
            const school = results.find(r => (r.student.school?._id || '').toString() === schoolId)?.student.school;
            const districtId = (school?.district?._id || '').toString();
            const rate = districtRates.get(districtId || '') || 1;
            await School.findByIdAndUpdate(schoolId, {
                score,
                averageScore: score / rate
            });
        }
    } catch (error) {
        console.error('Error updating school scores:', error);
    }
}

const updateTeacherScores = async (districtRates: Map<string, number>, teacherScores: Map<string, number>, results: IStudentResult[]) => {
    try {
        console.log("🔄 Обновление баллов учителей...");

        // Обновляем баллы для учителей
        for (const [teacherId, score] of teacherScores.entries()) {
            const teacher = results.find(r => (r.student.teacher?._id || '').toString() === teacherId)?.student.teacher;
            const districtId = teacher?.school?.district.toString();
            const rate = districtRates.get(districtId || '') || 1;
            await Teacher.findByIdAndUpdate(teacherId, {
                score,
                averageScore: score / rate
            });
        }
    } catch (error) {
        console.error('Error updating teacher scores:', error);
    }
}

const updateStudentScores = async (districtRates: Map<string, number>, studentScores: Map<string, number>, results: IStudentResult[]) => {
    try {
        console.log("🔄 Обновление баллов студентов...");
        
        // Обновляем баллы для студентов
        for (const [studentId, score] of studentScores.entries()) {
            const student = results.find(r => (r.student._id || '').toString() === studentId)?.student;
            const districtId = (student?.district?._id || '').toString();
            const rate = districtRates.get(districtId || '') || 1;
            await Student.findByIdAndUpdate(studentId, {
                score,
                averageScore: score / rate
            });
        }
    } catch (error) {
        console.error('Error updating student scores:', error);
    }
}