import { Request, Response, NextFunction } from "express";
import { GradePromotionUseCase } from "../usecases/gradePromotion.usecase";
import { GradePromotionServicePg } from "../services/gradePromotion.service.pg";
import { academicYearClosureServicePg } from "../services/academicYearClosure.service.pg";
import { statsServicePg } from "../services/stats.service.pg";
import { getCurrentAcademicYear } from "../utils/academic-year.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class GradePromotionController {
    private gradePromotionUseCase: GradePromotionUseCase;

    constructor() {
        this.gradePromotionUseCase = new GradePromotionUseCase(new GradePromotionServicePg());
    }

    preview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const preview = await this.gradePromotionUseCase.preview();
            res.json(ResponseHandler.success(preview));
        } catch (error) {
            next(error);
        }
    }

    execute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.body?.confirm) {
                res.status(400).json(ResponseHandler.badRequest('Təsdiq tələb olunur (confirm: true)'));
                return;
            }

            const result = await this.gradePromotionUseCase.execute(parseInt(req.user!.userId, 10));
            res.json(ResponseHandler.success(result, `${result.promotedCount} şagird növbəti sinfə keçirildi`));
        } catch (error) {
            next(error);
        }
    }

    /**
     * ACADEMIC_YEAR_ARCHIVE_TASK.md §3.5 — что случится, если сейчас закрыть текущий учебный
     * год. ensureFinishedYearsClosed() тоже вызывается здесь, чтобы админка всегда показывала
     * уже актуальное состояние (годы, закрытые авто-закрытием на старте, не требуют рестарта
     * бэкенда, чтобы отразиться в этом ответе).
     */
    previewClosure = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await academicYearClosureServicePg.ensureFinishedYearsClosed();

            const academicYear = getCurrentAcademicYear();
            const existing = await academicYearClosureServicePg.getClosure(academicYear);
            const counts = existing ? existing.checksums : await academicYearClosureServicePg.computeChecksums(academicYear);

            res.json(ResponseHandler.success({
                academicYear,
                alreadyClosed: !!existing,
                closedAt: existing?.closedAt ?? null,
                closedBy: existing?.closedByEmail ?? null,
                closedReason: existing?.closedReason ?? null,
                counts,
            }));
        } catch (error) {
            next(error);
        }
    }

    executeClosure = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.body?.confirm) {
                res.status(400).json(ResponseHandler.badRequest('Təsdiq tələb olunur (confirm: true)'));
                return;
            }

            const academicYear = getCurrentAcademicYear();
            const userId = parseInt(req.user!.userId, 10);
            const note: string | undefined = typeof req.body?.note === "string" ? req.body.note : undefined;

            // Финальный пересчёт ДО заморозки — год ещё не закрыт, значит updateAllStats()
            // пройдёт (assertYearNotClosed внутри него проверяет то же самое academicYear).
            await statsServicePg.updateAllStats();
            await academicYearClosureServicePg.closeManually(academicYear, userId, note);
            res.json(ResponseHandler.success({ academicYear }, `${academicYear}/${academicYear + 1} tədris ili bağlandı`));
        } catch (error) {
            next(error);
        }
    }
}

const gradePromotionController = new GradePromotionController();

export const previewGradePromotion = gradePromotionController.preview;
export const executeGradePromotion = gradePromotionController.execute;
export const previewClosure = gradePromotionController.previewClosure;
export const executeClosure = gradePromotionController.executeClosure;
