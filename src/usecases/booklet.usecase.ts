import { Types } from "mongoose";
import { BookletService, BookletFilterOptions } from "../services/booklet.service";
import { IBooklet, IBookletCreate } from "../models/booklet.model";
import { PaginationOptions, SortOptions } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export interface BookletUploadResult {
    processedCount: number;
    errors: string[];
}

export class BookletUseCase {
    constructor(private bookletService: BookletService) {}

    async getBooklets(
        pagination: PaginationOptions,
        filters: BookletFilterOptions,
        sort: SortOptions
    ): Promise<{ data: IBooklet[]; totalCount: number }> {
        return await this.bookletService.getFiltered(pagination, filters, sort);
    }

    async getBookletById(id: string): Promise<IBooklet> {
        const validationError = ValidationUtils.validateObjectId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(id);
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        return booklet;
    }

    async createBooklet(data: IBookletCreate): Promise<IBooklet> {
        ValidationUtils.validateRequired(data.exam, "Exam");
        ValidationUtils.validateRequired(data.variant, "Variant");
        ValidationUtils.validateRequired(data.grade, "Grade");
        ValidationUtils.validateRequired(data.disciplines, "Disciplines");

        const examId = new Types.ObjectId(data.exam.toString());
        const existing = await this.bookletService.findOne({
            examId,
            variant: data.variant,
            grade: data.grade,
        });

        if (existing) {
            throw new Error(
                `Booklet for this exam, variant "${data.variant}" and grade ${data.grade} already exists`
            );
        }

        return await this.bookletService.create(data);
    }

    async updateBooklet(id: string, updateData: Partial<IBookletCreate>): Promise<IBooklet> {
        const validationError = ValidationUtils.validateObjectId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(id);
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        // If key fields change, check for duplicates
        const newVariant = updateData.variant ?? booklet.variant;
        const newGrade = updateData.grade ?? booklet.grade;
        const newExam = updateData.exam ?? booklet.exam;

        if (updateData.variant || updateData.grade || updateData.exam) {
            const duplicate = await this.bookletService.findOne({
                examId: newExam.toString(),
                variant: newVariant,
                grade: newGrade,
            });

            if (duplicate && duplicate._id.toString() !== id) {
                throw new Error(
                    `Booklet for this exam, variant "${newVariant}" and grade ${newGrade} already exists`
                );
            }
        }

        return await this.bookletService.update(id, updateData);
    }

    async deleteBooklet(id: string): Promise<void> {
        const validationError = ValidationUtils.validateObjectId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(id);
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        await this.bookletService.delete(id);
    }

    async processBookletsFromExcel(
        filePath: string,
        examId: string
    ): Promise<BookletUploadResult> {
        ValidationUtils.validateRequired(examId, "Exam ID");

        const validationError = ValidationUtils.validateObjectId(examId, "Exam ID");
        if (validationError) {
            throw new Error(validationError);
        }

        return await this.bookletService.parseAndUpsertFromExcel(filePath, examId);
    }
}
