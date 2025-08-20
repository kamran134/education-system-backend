import { DeleteResult, Types } from "mongoose";
import Exam, { IExam, IExamCreate } from "../models/exam.model";
import StudentResult from "../models/studentResult.model";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";

export class ExamService {
    async findById(id: string): Promise<IExam | null> {
        return await Exam.findById(id);
    }

    async findByCode(code: number): Promise<IExam | null> {
        return await Exam.findOne({ code });
    }

    async create(examData: IExamCreate): Promise<IExam> {
        const exam = new Exam(examData);
        return await exam.save();
    }

    async update(id: string, updateData: Partial<IExamCreate>): Promise<IExam> {
        const updatedExam = await Exam.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedExam) {
            throw new Error('Exam not found');
        }

        return updatedExam;
    }

    async delete(id: string): Promise<void> {
        // Delete associated student results first
        await StudentResult.deleteMany({ exam: id });

        const result = await Exam.findByIdAndDelete(id);
        if (!result) {
            throw new Error('Exam not found');
        }
    }

    async deleteBulk(ids: Types.ObjectId[]): Promise<BulkOperationResult> {
        // Delete associated data first
        for (const id of ids) {
            await this.delete(id.toString());
        }

        return {
            insertedCount: 0,
            modifiedCount: 0,
            deletedCount: ids.length,
            errors: []
        };
    }

    async getFilteredExams(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IExam[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            Exam.find(filter)
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            Exam.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async getExamsForFilter(filters: FilterOptions): Promise<IExam[]> {
        const filter = this.buildFilter(filters);
        
        return await Exam.find(filter)
            .sort({ date: -1 });
    }

    async getExamsByMonthYear(month: number, year: number): Promise<IExam[]> {
        // Определяем диапазон дат для поиска экзаменов
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);

        // Получаем все экзамены за указанный месяц и год
        const exams: IExam[] = await Exam.find({
            date: { $gte: startDate, $lte: endDate }
        });

        return exams;
    }

    async processExamsFromExcel(filePath: string): Promise<FileProcessingResult<IExam>> {
        const processedData: IExam[] = [];
        const errors: string[] = [];
        const skippedItems: any[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 4) {
                throw new Error('Invalid Excel file format');
            }

            const rows = data.slice(3); // Skip header rows
            const dataToInsert = rows.map(row => ({
                code: Number(row[1]),
                name: String(row[2]),
                date: new Date(row[3])
            })).filter(data => data.code > 0 && data.name && data.date);

            // Check existing exams
            const existingExamCodes = await this.checkExistingExamCodes(
                dataToInsert.map(data => data.code)
            );
            
            const newExams = existingExamCodes.length > 0
                ? dataToInsert.filter(data => !existingExamCodes.includes(data.code))
                : dataToInsert;

            // Create exams
            const examsToCreate: IExamCreate[] = newExams.map(examData => ({
                code: examData.code,
                name: examData.name,
                date: examData.date,
                active: true
            }));

            const createdExams = await Exam.insertMany(examsToCreate);
            processedData.push(...createdExams.map(e => e.toObject() as IExam));

            // Clean up
            deleteFile(filePath);

            return {
                processedData,
                errors,
                skippedItems: existingExamCodes.map(code => ({ code, reason: 'Already exists' }))
            };
        } catch (error) {
            deleteFile(filePath);
            throw error;
        }
    }

    async checkExistingExamCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await Exam.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        if (filters.dateFrom || filters.dateTo) {
            filter.date = {};
            if (filters.dateFrom) {
                filter.date.$gte = new Date(filters.dateFrom);
            }
            if (filters.dateTo) {
                filter.date.$lte = new Date(filters.dateTo);
            }
        }

        return filter;
    }
}

// Legacy function for backward compatibility
const examService = new ExamService();

export const getExamsByMonthYear = async (month: number, year: number): Promise<IExam[] | []> => {
    return await examService.getExamsByMonthYear(month, year);
}
