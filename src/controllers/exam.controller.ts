import { Request, Response } from "express";
import Exam, { IExam } from "../models/exam.model";
import StudentResult from "../models/studentResult.model";

export const getExams = async (req: Request, res: Response) => {
    try {
        const page: number = parseInt(req.query.page as string) || 1;
        const size: number = parseInt(req.query.size as string) || 10;
        const skip: number = (page - 1) * size;

        const [data, totalCount] = await Promise.all([
            Exam.find()
                .sort({ date: 1 })
                .skip(skip)
                .limit(size),
            Exam.countDocuments()
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "İmtahanların alınmasında xəta", error });
    }
}

export const getExamsByMonthYear = async (month: number, year: number): Promise<IExam[] | []> => {
    // Определяем диапазон дат для поиска экзаменов
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    
        // Получаем все экзамены за указанный месяц и год
        const exams: IExam[] = await Exam.find({
            date: { $gte: startDate, $lte: endDate }
        });

        return exams;
}

export const createExam = async (req: Request, res: Response) => {
    try {
        const { name, code, date } = req.body;

        const existingExam = await Exam.findOne({ code, date });

        if (existingExam) {
            res.status(400).json({ message: "Bu kodda və tarixdə imtahan artıq mövcuddur!" });
            return;
        }

        const exam = new Exam({ name, code, date });
        const savedExam = await exam.save();
        res.status(201).json(savedExam);
    } catch (error) {
        res.status(500).json({ message: "İmtahanın yaradılmasında xəta!", error });
    }
}

export const deleteAllExams = async (req: Request, res: Response) => {
    try {
        await StudentResult.deleteMany();
        const result = await Exam.deleteMany();
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}

export const deleteExam = async (req: Request, res: Response) => {
    try {
        const examId = req.params.id;

        await StudentResult.deleteMany({ exam: examId });
        const result = await Exam.findByIdAndDelete(req.params.id);

        if (!result) {
            res.status(404).json({ message: "İmtahan tapılmadı" });
        }
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}