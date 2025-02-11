import { Request, Response } from "express";
import mongoose from "mongoose";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import Student, { IStudent } from "../models/student.model";
import District, { IDistrict } from "../models/district.model";
import School, { ISchool } from "../models/school.model";
import Teacher, { ITeacher } from "../models/teacher.model";

export const updateStatistics = async (req: Request, res: Response) => {
    try {
        // Statistikaları yenilə
        /**
         * 1. Пробегаемся по всем результатам экзаменов (StudentResult)
         * 2. Группируем результаты по студентам (Student)
         * 3. Каждому студенту в maxLevel записываем максимальный уровень, который он прошел
         *    Уровни: 0-15: E, 16-25: D, 26-34: C, 35-41: B, 42-46: A, 47-50: Lisey
         * 4. Каждому студенту в status записываем статус: если уровень поднялся (по хронологии экзаменов), то в статус пишем "inkişaf edən şagird". А также добавляем в его score 10, в его район, школу и учителю тоже 10
         * 5. Если студент в своём районе набрал самый высокий балл по последнему экзамену, то в его статус пишем (добавляем) "ayın şagirdi". А также добавляем в его score 5, в его район, школу и учителю тоже 5
         * 7. В score районов, школ и учителей добавляем сумму баллов всех студентов
         * 8. Сохраняем все изменения в базе данных
         */

        // 1. Пробегаемся по всем результатам экзаменов (StudentResult)
        const studentResults: IStudentResult[] = await StudentResult.find()
            .populate("student")
            .populate("exam")
            .sort({ examDate: 1 });
        
        const latestExam = studentResults.reduce((latest, result) => 
            new Date(result.exam.date) > new Date(latest.exam.date) ? result : latest
        );
        
        const latestMonth = new Date(latestExam.exam.date).getMonth();
        const latestYear = new Date(latestExam.exam.date).getFullYear();
        
        // 2. Группируем результаты по студентам (Student)
        const students: any = {};
        studentResults.forEach((studentResult: any) => {
            if (!students[studentResult.student._id]) {
                students[studentResult.student._id] = {
                    student: studentResult.student,
                    results: [],
                };
            }

            students[studentResult.student._id].results.push(studentResult);
        });

        // 3. Каждому студенту в maxLevel записываем максимальный уровень, который он прошел, без учёта последнего экзамена
        //    Уровни: 0-15: E, 16-25: D, 26-34: C, 35-41: B, 42-46: A, 47-50: Lisey
        for (const studentId in students) {
            const student = students[studentId];
            student.student.status = "";
            if (student.results.length <= 1) continue;
            // исключаем последний экзамен, так как он определяет статус студента
            student.student.maxLevel = student.results.slice(1).reduce((maxLevel: number, result: any) => {
                return Math.max(maxLevel, result.totalScore);
            }, 0);
            const studentMaxlevel: string = calculateLevel(student.student.maxLevel);
            const studentLastLevel: string = calculateLevel(student.results[0].totalScore);

            if (student.student.maxLevel < student.results[0].totalScore && studentMaxlevel !== studentLastLevel) {
                //student.student.status.push("İnkişaf edən şagird");
                student.student.status = "İnkişaf edən şagird";
                student.student.maxLevel = student.results[0].totalScore;
                student.results[0].score += 10;
                // обновляем в базе данных статус студента
                
            }
            await Student.findByIdAndUpdate(studentId, { status: student.student.status, maxLevel: student.student.maxLevel }, { new: true });
            await StudentResult.findByIdAndUpdate(student.results[0]._id, { score: student.results[0].score });
        }

        // 5. Если студент в своём районе набрал самый высокий балл по последнему экзамену, то в его статус пишем (добавляем) "ayın şagirdi". 
        // А также добавляем в его score +5
        // У нас есть students, его группируем по районам
        const districtResults: any = {};
        for (const studentId in students) {
            const student = students[studentId];
            const districtId = student.student.district;
            if (!districtResults[districtId]) {
                districtResults[districtId] = [];
            }

            districtResults[districtId].push(student);
        }

        // берём districtResults, пробегаемся по последним результатам каждого студента, выясняем кто набрал самый высокий балл
        // и добавляем статус "ayın şagirdi" и +5 к score
        for (const districtId in districtResults) {
            const districtResult = districtResults[districtId];
            const latestMonthResults = districtResult
                //.flatMap((student: any) => student.results)
                .filter((result: any) => {
                    if (!result.exam || !result.exam.date) return false;
                    const examDate = new Date(result.exam.date);
                    return examDate.getMonth() === latestMonth && examDate.getFullYear() === latestYear;
                });

            // Находим максимальный totalScore за этот месяц
            const maxTotalScore = latestMonthResults.reduce((maxScore: number, result: any) =>
                Math.max(maxScore, result.totalScore), 0
            );

            //console.log('Distrcit res: ', JSON.stringify(districtResult));
            //console.log('\nDistrict latest month: ', JSON.stringify(latestMonthResults));
            
            // теперь всем студентам с этим баллом добавляем статус "ayın şagirdi"
            for (const student of latestMonthResults) {
                if (student.results[0].totalScore === maxTotalScore && maxTotalScore >= 47) {
                    // student.student.status.push("Ayın şagirdi");
                    // if (student.student.code == 1403707020) console.log('That is Sadraddinova: ', student.student.status);
                    student.student.status = student.student.status ? `${student.student.status}, Ayın şagirdi` : "Ayın şagirdi";
                    student.results[0].score += 5;
                    // обновляем в базе данных статус студента (добавляем новый статус через запятую)
                    await Student.findByIdAndUpdate(student.student._id, { status: student.student.status }, { new: true });
                    await StudentResult.findByIdAndUpdate(student.results[0]._id, { score: student.results[0].score });
                }
            }
        }
        
        const lastExam = await StudentResult.find()
            .populate("exam")
            .sort({ "exam.date": -1 }) // Сортируем по убыванию даты
            .limit(1);

        if (!lastExam.length) {
            console.log("В базе нет результатов");
            return;
        }

        const lastExamDate = new Date(lastExam[0].exam.date);
        const lastYear = lastExamDate.getFullYear();
        const lastMonth = lastExamDate.getMonth() + 1; // Январь — 0, поэтому +1

        const studentResultsByDate: IStudentResult[] = await StudentResult.find()
            .populate("student")
            .populate("exam")
            .where("exam.date")
            .gte(new Date(lastYear, lastMonth - 1, 1).getTime()) // Первый день месяца
            .lt(new Date(lastYear, lastMonth, 1).getTime()) // Первый день следующего месяца
            .sort({ totalScore: -1 }); // Сортируем по убыванию totalScore
        
        res.status(200).json({ message: "Statistika yeniləndi" });
    } catch (error) {
        res.status(500).json({ message: "Statistikanın yenilənməsində xəta", error });
    }
}

export const updateStatisticsByRepublic = async (req: Request, res: Response) => {
    try {
        // 1. Пробегаемся по всем результатам экзаменов (StudentResult)
        const studentResults: IStudentResult[] = await StudentResult.find()
        .populate("student")
        .populate("exam")
        .sort({ examDate: 1 });

        const latestExam = studentResults.reduce((latest, result) => 
            new Date(result.exam.date) > new Date(latest.exam.date) ? result : latest
        );
        
        const latestMonth = new Date(latestExam.exam.date).getMonth();
        const latestYear = new Date(latestExam.exam.date).getFullYear();

        // 2. Группируем результаты по студентам (Student)
        const students: any = {};
        studentResults.forEach((studentResult: any) => {
            if (!students[studentResult.student._id]) {
                students[studentResult.student._id] = {
                    student: studentResult.student,
                    results: [],
                };
            }

            students[studentResult.student._id].results.push(studentResult);
        });

        const latestMonthResults = studentResults
            .filter((result: any) => {
                if (!result.exam || !result.exam.date) return false;
                const examDate = new Date(result.exam.date);
                return examDate.getMonth() === latestMonth && examDate.getFullYear() === latestYear;
            });

        // console.log('latesMothResults: ', JSON.stringify(latestMonthResults));
        // сначала выясняем самый высокий бал по всем студентам
        const maxTotalScore = Math.max(...latestMonthResults.map(r => r.totalScore));
        for (const studentId in latestMonthResults) {
            const student = students[studentId];
            // maxTotalScore = Math.max(maxTotalScore, student.results[0].totalScore);
        }

        console.log('max score: ', maxTotalScore);

        // теперь всем студентам с этим баллом добавляем статус "Respublika üzrə ayın şagirdi"
        for (const studentId in students) {
            const student = students[studentId];
            if (student.results[0].totalScore === maxTotalScore && maxTotalScore >= 47) {
                // student.student.status.push("Respublika üzrə ayın şagirdi");
                student.student.status = student.student.status ? `${student.student.status}, Respublika üzrə ayın şagirdi` : "Respublika üzrə ayın şagirdi";
                student.result[0].score += 5;
                // обновляем в базе данных статус студента
                await Student.findByIdAndUpdate(studentId, { status: student.student.status }, { new: true });
                await StudentResult.findByIdAndUpdate(student.results[0]._id, { score: student.results[0].score });
            }
        }

        res.status(200).json({ message: "Respublika üzrə statistika uğurla yeniləndi!" });
    } catch (error) {
        res.status(500).json({ message: "Respublika üzrə statistikanın yenilənməsində xəta", error });
    }
    
}

export const calculateAndSaveScores = async (req: Request, res: Response) => {
    try {
        const results = await StudentResult.find().populate('student');
        
        const districtScores = new Map<string, number>();
        const schoolScores = new Map<string, number>();
        const teacherScores = new Map<string, number>();

        for (const result of results) {
            const student = result.student as IStudent;
            if (!student) continue;

            const { district, school, teacher } = student;
            const score = result.totalScore;
            
            if (district) {
                districtScores.set(district.toString(), (districtScores.get(district.toString()) || 0) + score);
            }
            if (school) {
                schoolScores.set(school.toString(), (schoolScores.get(school.toString()) || 0) + score);
            }
            if (teacher) {
                teacherScores.set(teacher.toString(), (teacherScores.get(teacher.toString()) || 0) + score);
            }
        }

        // Обновление данных в базе
        for (const [districtId, score] of districtScores) {
            await District.findByIdAndUpdate(districtId, { score }, { new: true });
        }
        for (const [schoolId, score] of schoolScores) {
            await School.findByIdAndUpdate(schoolId, { score }, { new: true });
        }
        for (const [teacherId, score] of teacherScores) {
            await Teacher.findByIdAndUpdate(teacherId, { score }, { new: true });
        }

        console.log('Scores updated successfully');
    } catch (error) {
        console.error('Error updating scores:', error);
    }
}

const calculateLevel = (totalScore: number): string => {
    if (totalScore >= 16 && totalScore <= 25) {
        return "D";
    } else if (totalScore >= 26 && totalScore <= 34) {
        return "C";
    } else if (totalScore >= 35 && totalScore <= 41) {
        return "B";
    } else if (totalScore >= 42 && totalScore <= 46) {
        return "A";
    } else if (totalScore >= 47) {
        return "Lisey";
    } else {
        return "E";
    }
}

export const getStatistics = async (req: Request, res: Response) => {
    try {
        const studentsOfMonth: IStudent[] = await Student.find({ status: { $regex: "Ayın şagirdi", $options: "i" } });
        const studentsOfMonthByRepublic: IStudent[] = await Student.find({ status: { $regex: "Respublika üzrə ayın şagirdi", $options: "i" } });
        const developingStudents: IStudent[] = await Student.find({ status: { $regex: "İnkişaf edən şagird", $options: "i" } });
        res.status(200).json({ studentsOfMonth, studentsOfMonthByRepublic, developingStudents });
    } catch (error) {
        res.status(500).json({ message: "Statistikanın alınmasında xəta", error });
    }
}