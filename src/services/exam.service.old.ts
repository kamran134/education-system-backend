import Exam, { IExam } from "../models/exam.model";

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