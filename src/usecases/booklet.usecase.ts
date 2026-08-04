import { BookletServicePg, BookletFilterOptionsPg, Booklet, BookletCreate } from "../services/booklet.service.pg";
import { PaginationOptions, SortOptions } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";

export interface BookletUploadResult {
    processedCount: number;
    errors: string[];
}

export class BookletUseCase {
    constructor(private bookletService: BookletServicePg) {}

    async getBooklets(
        pagination: PaginationOptions,
        filters: BookletFilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: Booklet[]; totalCount: number }> {
        return await this.bookletService.getFiltered(pagination, filters, sort);
    }

    async getBookletById(id: string): Promise<Booklet> {
        const validationError = ValidationUtils.validateId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(parseInt(id, 10));
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        return booklet;
    }

    async createBooklet(data: Partial<BookletCreate>): Promise<Booklet> {
        ValidationUtils.validateRequired(data.examId, "Exam");
        ValidationUtils.validateRequired(data.variant, "Variant");
        ValidationUtils.validateRequired(data.grade, "Grade");
        ValidationUtils.validateRequired(data.disciplines, "Disciplines");

        const existing = await this.bookletService.findOne({
            examId: data.examId,
            variant: data.variant,
            grade: data.grade,
        });

        if (existing) {
            throw new Error(
                `Booklet for this exam, variant "${data.variant}" and grade ${data.grade} already exists`
            );
        }

        return await this.bookletService.create(data as BookletCreate);
    }

    async updateBooklet(id: string, updateData: Partial<BookletCreate>): Promise<Booklet> {
        const validationError = ValidationUtils.validateId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(parseInt(id, 10));
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        // If key fields change, check for duplicates
        const newVariant = updateData.variant ?? booklet.variant;
        const newGrade = updateData.grade ?? booklet.grade;
        const newExamId = updateData.examId ?? booklet.examId;

        if (updateData.variant || updateData.grade || updateData.examId) {
            const duplicate = await this.bookletService.findOne({
                examId: newExamId,
                variant: newVariant,
                grade: newGrade,
            });

            if (duplicate && duplicate.id !== parseInt(id, 10)) {
                throw new Error(
                    `Booklet for this exam, variant "${newVariant}" and grade ${newGrade} already exists`
                );
            }
        }

        return await this.bookletService.update(parseInt(id, 10), updateData);
    }

    async deleteBooklet(id: string): Promise<void> {
        const validationError = ValidationUtils.validateId(id, "Booklet ID");
        if (validationError) {
            throw new Error(validationError);
        }

        const booklet = await this.bookletService.findById(parseInt(id, 10));
        if (!booklet) {
            throw new Error("Booklet not found");
        }

        await this.bookletService.delete(parseInt(id, 10));
    }

    async processBookletsFromExcel(
        filePath: string,
        examId: string
    ): Promise<BookletUploadResult> {
        ValidationUtils.validateRequired(examId, "Exam ID");

        const validationError = ValidationUtils.validateId(examId, "Exam ID");
        if (validationError) {
            throw new Error(validationError);
        }

        return await this.bookletService.parseAndUpsertFromExcel(filePath, parseInt(examId, 10));
    }
}
