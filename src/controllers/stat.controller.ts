import { Request, Response } from "express";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import Exam from "../models/exam.model";
import Teacher from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { updateStats } from "../services/stats.service";
import { Types } from "mongoose";

export const updateStatistics = async (req: Request, res: Response) => {
    try {
        const status = await updateStats();
        
        if (status === 404) {
            res.status(404).json({ message: "404: Nəticələr tapılmadı!" });
            return;
        }
        res.status(200).json({ message: "Statistika yeniləndi" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın yenilənməsində xəta!", error });
    }
}

// Ayın şagirdləri, Respublika üzrə ayın şagirdləri və İnkişaf edən şagirdlərin statistikası
export const getStudentsStatistics = async (req: Request, res: Response) => {
    try {
        const { month } = req.query;

        const districtIds: Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const schoolIds: Types.ObjectId[] = req.query.schoolIds
            ? (req.query.schoolIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const teacherIds: Types.ObjectId[] = req.query.teacherIds
            ? (req.query.teacherIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const grades: number[] = req.query.grades
            ? (req.query.grades as string).split(',').map(grade => parseInt(grade, 10))
            : [];
        const code: number = req.query.code ? parseInt(req.query.code as string) : 0;
        let examIds: Types.ObjectId[] = req.query.examIds
            ? (req.query.examIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];

        if (!month) {
            res.status(400).json({ message: "Ay seçilməyib!" });
            return;
        }

        const [year, monthStr] = (month as string).split("-");
        const monthIndex: number = parseInt(monthStr, 10) - 1;
        const selectedMonth = new Date(parseInt(year, 10), monthIndex, 1);
        const startDate = new Date(selectedMonth);
        const endDate = new Date(new Date(startDate).setMonth(startDate.getMonth() + 1));

        if (examIds.length === 0) {
            examIds = await Exam.find({ date: { $gte: startDate, $lt: endDate } }).select('_id');
        }

        if (examIds.length === 0) {
            res.status(404).json({ message: "Bu ayda imtahan tapılmadı!" });
            return;
        }

        let codeString: string = '';
        let codeStringEnd: string = '';

        if (code) {
            codeString = code.toString().padEnd(10, '0');
            codeStringEnd = code.toString().padEnd(10, '9');
        }

        const pipeline: any[] = [
            // 1. Фильтруем результаты по экзаменам месяца
            { $match: { exam: { $in: examIds.map(e => e._id) } } },

            // 2. Присоединяем данные студентов
            {
                $lookup: {
                    from: 'students',
                    localField: 'student',
                    foreignField: '_id',
                    as: 'studentData'
                }
            },
            { $unwind: '$studentData' }, // Разворачиваем массив studentData

            // 3. Присоединяем связанные данные (district, school, teacher)
            {
                $lookup: { from: 'districts', localField: 'studentData.district', foreignField: '_id', as: 'studentData.district' }
            },
            { $unwind: { path: '$studentData.district', preserveNullAndEmptyArrays: true } },
            {
                $lookup: { from: 'schools', localField: 'studentData.school', foreignField: '_id', as: 'studentData.school' }
            },
            { $unwind: { path: '$studentData.school', preserveNullAndEmptyArrays: true } },
            {
                $lookup: { from: 'teachers', localField: 'studentData.teacher', foreignField: '_id', as: 'studentData.teacher' }
            },
            { $unwind: { path: '$studentData.teacher', preserveNullAndEmptyArrays: true } },

            // 4. Применяем фильтры по districtIds, schoolIds, teacherIds
            {
                $match: {
                    ...(districtIds.length > 0 && { 'studentData.district._id': { $in: districtIds } }),
                    ...(schoolIds.length > 0 && { 'studentData.school._id': { $in: schoolIds } }),
                    ...(teacherIds.length > 0 && { 'studentData.teacher._id': { $in: teacherIds } }),
                    ...(grades.length > 0 && { 'studentData.grade': { $in: grades } }),
                    ...(code && { 'studentData.code': { $gte: parseInt(codeString), $lte: parseInt(codeStringEnd) } }),
                    // выберем только тех, у кого studentData.school.active = true и studentData.teacher.active = true
                    //...({ 'studentData.school.active': true, 'studentData.teacher.active': true })
                }
            },

            // 5. Присоединяем данные экзаменов
            {
                $lookup: {
                    from: 'exams',
                    localField: 'exam',
                    foreignField: '_id',
                    as: 'examData'
                }
            },
            { $unwind: '$examData' }
        ];

        const studentResults = await StudentResult.aggregate(pipeline);
        
        const studentsOfMonth: IStudentResult[] = studentResults.filter(r => r.status?.match(/Ayın şagirdi/i));
        const studentsOfMonthByRepublic: IStudentResult[] = studentResults.filter(r => r.status?.match(/Respublika üzrə ayın şagirdi/i));
        const developingStudents: IStudentResult[] = studentResults.filter(r => r.status?.match(/İnkişaf edən şagird/i));

        res.status(200).json({ studentsOfMonth, studentsOfMonthByRepublic, developingStudents });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın alınmasında xəta", error });
    }
}

export const getStatisticsByExam = async (req: Request, res: Response) => {
    try {
        const examId = req.params.examId;
        const studentResults: IStudentResult[] = await StudentResult.find({ exam: examId })
            .populate("exam")
            .populate({ path: "student", populate: [
                { path: "district", model: "District" },
                { path: "school", model: "School" },
                { path: "teacher", model: "Teacher" }
            ]});

        const studentsOfMonth: IStudentResult[] = studentResults.filter(r => r.status?.match(/Ayın şagirdi/i));
        const studentsOfMonthByRepublic: IStudentResult[] = studentResults.filter(r => r.status?.match(/Respublika üzrə ayın şagirdi/i));
        const developingStudents: IStudentResult[] = studentResults.filter(r => r.status?.match(/İnkişaf edən şagird/i));

        res.status(200).json({ studentsOfMonth, studentsOfMonthByRepublic, developingStudents });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Statistikanın alınmasında xəta", error });
    }
}

// İlin müəllimləri
export const getTeacherStatistics = async (req: Request, res: Response) => {
    try {
        const districtIds: Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const schoolIds: Types.ObjectId[] = req.query.schoolIds
            ? (req.query.schoolIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const sortColumn: string = req.query.sortColumn?.toString() || 'averageScore';
        const sortDirection: string = req.query.sortDirection?.toString() || 'desc';

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;

        const filter: any = { score: { $exists: true }, averageScore: { $exists: true } };

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        if (schoolIds.length > 0) {
            filter.school = { $in: schoolIds };
        }
        
        // просто берём учителей из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const teachers = await Teacher
            .find(filter)
            .populate("school")
            .populate({ path: "school", populate: { path: "district", model: "District" } })
            .sort(sortOptions);

        res.status(200).json({ teachers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin statistikasının alınmasında xəta", error });
    }
}

// İlin məktəbləri
export const getSchoolStatistics = async (req: Request, res: Response) => {
    try {
        // просто берём школы из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const districtIds: Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const sortColumn: string = req.query.sortColumn?.toString() || 'averageScore';
        const sortDirection: string = req.query.sortDirection?.toString() || 'desc';

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        const filter: any = { score: { $exists: true }, averageScore: { $exists: true } };

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }

        const schools = await School
            .find(filter)
            .populate("district")
            .sort(sortOptions);

        res.status(200).json({ schools });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Məktəblərin statistikasının alınmasında xəta", error });
    }
}

// İlin rayonları
export const getDistrictStatistics = async (req: Request, res: Response) => {
    try {
        const sortColumn: string = req.query.sortColumn?.toString() || 'averageScore';
        const sortDirection: string = req.query.sortDirection?.toString() || 'desc';

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        // просто берём районы из базы, тех, у кого есть score и averageScore по убыванию averageScore
        const districts = await District
            .find({ score: { $exists: true }, averageScore: { $exists: true } })
            .sort(sortOptions);

        res.status(200).json({ districts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Rayonların statistikasının alınmasında xəta", error });
    }
}