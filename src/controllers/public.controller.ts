import { Request, Response, NextFunction } from "express";
import { PublicUseCase } from "../usecases/public.usecase";
import { PublicServicePg } from "../services/public.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

export class PublicController {
    private publicUseCase: PublicUseCase;

    constructor() {
        this.publicUseCase = new PublicUseCase(new PublicServicePg());
    }

    getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const summary = await this.publicUseCase.getSummary();
            res.json(ResponseHandler.success(summary, "Məlumat uğurla alındı"));
        } catch (error) {
            next(error);
        }
    }
}
