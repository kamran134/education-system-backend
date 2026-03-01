import { Request, Response, NextFunction } from "express";
import { BookletUseCase } from "../usecases/booklet.usecase";
import { BookletService, BookletFilterOptions } from "../services/booklet.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { Types } from "mongoose";

export class BookletController {
    private bookletUseCase: BookletUseCase;

    constructor() {
        this.bookletUseCase = new BookletUseCase(new BookletService());
    }

    getBooklets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const sort = RequestParser.parseSorting(req, "grade", "asc");

            const filters: BookletFilterOptions = {};
            if (req.query.examId) {
                filters.examId = new Types.ObjectId(req.query.examId as string);
            }
            if (req.query.variant) {
                filters.variant = req.query.variant as string;
            }
            if (req.query.grade) {
                filters.grade = parseInt(req.query.grade as string, 10);
            }

            const result = await this.bookletUseCase.getBooklets(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount,
            }, "Booklets retrieved successfully"));
        } catch (error) {
            next(error);
        }
    }

    getBookletById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const booklet = await this.bookletUseCase.getBookletById(id);

            res.json(ResponseHandler.success(booklet, "Booklet retrieved successfully"));
        } catch (error) {
            next(error);
        }
    }

    createBooklet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const booklet = await this.bookletUseCase.createBooklet(req.body);

            res.status(201).json(ResponseHandler.created(booklet, "Booklet created successfully"));
        } catch (error) {
            next(error);
        }
    }

    updateBooklet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const booklet = await this.bookletUseCase.updateBooklet(id, req.body);

            res.json(ResponseHandler.updated(booklet, "Booklet updated successfully"));
        } catch (error) {
            next(error);
        }
    }

    deleteBooklet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.bookletUseCase.deleteBooklet(id);

            res.json(ResponseHandler.deleted("Booklet deleted successfully"));
        } catch (error) {
            next(error);
        }
    }

    uploadBooklets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest("Fayl yüklənməyib!"));
                return;
            }

            const { examId } = req.body;
            if (!examId) {
                res.status(400).json(ResponseHandler.badRequest("İmtahan seçilməyib!"));
                return;
            }

            const result = await this.bookletUseCase.processBookletsFromExcel(req.file.path, examId);

            res.status(201).json(ResponseHandler.created(result, "Kitabça cavabları uğurla yükləndi!"));
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const bookletController = new BookletController();

export const getBooklets    = bookletController.getBooklets;
export const getBookletById = bookletController.getBookletById;
export const createBooklet  = bookletController.createBooklet;
export const updateBooklet  = bookletController.updateBooklet;
export const deleteBooklet  = bookletController.deleteBooklet;
export const uploadBooklets = bookletController.uploadBooklets;