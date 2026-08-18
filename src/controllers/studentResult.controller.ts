import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { StudentResultUseCase } from "../usecases/studentResult.usecase";
import { StudentResultServicePg } from "../services/studentResult.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class StudentResultController {
    private studentResultUseCase: StudentResultUseCase;

    constructor() {
        this.studentResultUseCase = new StudentResultUseCase(new StudentResultServicePg());
    }

    /**
     * Mongo-версия (IStudentResultInput) принимала `student`/`exam` (имена ref-полей модели)
     * и вложенные `disciplines`/`questionCounts` — тот же паттерн несогласованности имён,
     * что и у booklet (см. комментарий в booklet.controller.ts). Принимаем оба варианта.
     */
    private toStudentResultUpdate(body: any) {
        const studentRaw = body.studentId ?? body.student;
        const examRaw = body.examId ?? body.exam;
        return {
            ...(studentRaw !== undefined && { studentId: parseInt(studentRaw, 10) }),
            ...(examRaw !== undefined && examRaw !== null && { examId: parseInt(examRaw, 10) }),
            ...(body.grade !== undefined && { grade: parseInt(body.grade, 10) }),
            ...(body.disciplines !== undefined && { disciplines: body.disciplines }),
            ...(body.questionCounts !== undefined && { questionCounts: body.questionCounts }),
            ...(body.totalScore !== undefined && { totalScore: body.totalScore }),
            ...(body.level !== undefined && { level: body.level }),
            ...(body.participationScore !== undefined && { participationScore: body.participationScore }),
            ...(body.score !== undefined && { score: body.score }),
            // status НЕ принимается от клиента: единственный писатель — markDevelopingStudents
            // (stats.service.pg.ts), иначе status и development_score снова расходятся
            // (см. DB_REFACTOR_TASKS.md §4, гейт 2).
            ...(body.month !== undefined && { month: body.month }),
            ...(body.year !== undefined && { year: body.year }),
        };
    }

    getStudentResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'createdAt', 'desc');

            const result = await this.studentResultUseCase.getStudentResults(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getStudentResultById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.studentResultUseCase.getStudentResultById(id);

            if (!result) {
                res.status(404).json(ResponseHandler.notFound('Məlumat tapılmadı'));
                return;
            }

            res.json(ResponseHandler.success(result, 'Nəticə uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.studentResultUseCase.createStudentResult(this.toStudentResultUpdate(req.body) as any);

            res.status(201).json(ResponseHandler.created(result, 'Nəticə uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.studentResultUseCase.updateStudentResult(id, this.toStudentResultUpdate(req.body));

            res.json(ResponseHandler.updated(result, 'Nəticə uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteStudentResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.studentResultUseCase.deleteStudentResult(id);

            res.json(ResponseHandler.deleted('Nəticə uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    processStudentResultsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

            const result = await this.studentResultUseCase.processStudentResultsFromExcel(req.file.path, examId);

            res.status(201).json(ResponseHandler.created(result, "Şagirdlərin nəticələri uğurla yaradıldı!"));
        } catch (error) {
            next(error);
        } finally {
            if (req.file) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (unlinkError) {
                    console.error('Error deleting temp file:', unlinkError);
                }
            }
        }
    }

    deleteResultsByExamId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { examId } = req.params;
            if (!examId) {
                res.status(400).json(ResponseHandler.badRequest("İmtahan seçilməyib!"));
                return;
            }

            const result = await this.studentResultUseCase.deleteResultsByExamId(examId);

            if (result.deletedCount === 0) {
                res.status(404).json(ResponseHandler.notFound("Bu imtahan üçün nəticələr tapılmadı!"));
                return;
            }

            res.json(ResponseHandler.success(
                { deletedCount: result.deletedCount },
                "İmtahan nəticələri uğurla silindi!"
            ));
        } catch (error) {
            next(error);
        }
    }

    importLegacyResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest("Fayl yüklənməyib!"));
                return;
            }

            const result = await this.studentResultUseCase.importLegacyResults(req.file.path);

            res.status(200).json(ResponseHandler.success(result, "İdxal tamamlandı!"));
        } catch (error) {
            next(error);
        } finally {
            if (req.file) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (unlinkError) {
                    console.error('Error deleting temp file:', unlinkError);
                }
            }
        }
    }
}

const studentResultController = new StudentResultController();

export const getStudentResults = studentResultController.getStudentResults;
export const getStudentResultById = studentResultController.getStudentResultById;
export const createStudentResult = studentResultController.createStudentResult;
export const updateStudentResult = studentResultController.updateStudentResult;
export const deleteStudentResult = studentResultController.deleteStudentResult;
export const createAllResults = studentResultController.processStudentResultsFromExcel;
export const deleteResults = studentResultController.deleteResultsByExamId;
export const importLegacyResults = studentResultController.importLegacyResults;