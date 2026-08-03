import { Request, Response, NextFunction } from "express";
import { GradePromotionUseCase } from "../usecases/gradePromotion.usecase";
import { GradePromotionService } from "../services/gradePromotion.service";
import { ResponseHandler } from "../utils/response-handler.util";

export class GradePromotionController {
    private gradePromotionUseCase: GradePromotionUseCase;

    constructor() {
        this.gradePromotionUseCase = new GradePromotionUseCase(new GradePromotionService());
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

            const result = await this.gradePromotionUseCase.execute(req.user!.userId);
            res.json(ResponseHandler.success(result, `${result.promotedCount} şagird növbəti sinfə keçirildi`));
        } catch (error) {
            next(error);
        }
    }
}

const gradePromotionController = new GradePromotionController();

export const previewGradePromotion = gradePromotionController.preview;
export const executeGradePromotion = gradePromotionController.execute;
