import { Request, Response } from "express";
import { levelScaleServicePg } from "../services/levelScale.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

export const getLevelScales = async (req: Request, res: Response): Promise<void> => {
    try {
        const data = await levelScaleServicePg.findAll();
        res.status(200).json(ResponseHandler.success(data));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching level scales", error));
    }
};
