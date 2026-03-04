import Exam, { IExam } from "../models/exam.model";

export const getExamsByMonthYear = async (month: number, year: number): Promise<IExam[] | []> => {
    // Определяем диапазон дат в UTC — даты хранятся как UTC midnight
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    // Получаем все экзамены за указанный месяц и год
    const exams: IExam[] = await Exam.find({
        date: { $gte: startDate, $lt: endDate }
    });

    return exams;
}