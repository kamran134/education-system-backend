import { Request, Response } from "express";
import { subjectServicePg } from "../services/subject.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";
import { ValidationUtils } from "../utils/validation.util";

export const getSubjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const data = await subjectServicePg.findAll();
        res.status(200).json(ResponseHandler.success(data));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching subjects", error));
    }
};

export const createSubject = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code, nameAz } = req.body;
        const errors = [
            ValidationUtils.validateRequired(code, "code"),
            ValidationUtils.validateRequired(nameAz, "nameAz"),
        ].filter((e): e is string => e !== null);
        if (errors.length > 0) {
            res.status(400).json(ResponseHandler.badRequest(errors.join(", ")));
            return;
        }

        const created = await subjectServicePg.create(req.body);
        res.status(201).json(ResponseHandler.created(created));
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error creating subject", error));
    }
};

export const updateSubject = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code } = req.params;
        if (!code) {
            res.status(400).json(ResponseHandler.badRequest("code is required"));
            return;
        }

        const updated = await subjectServicePg.update(code, req.body);
        res.status(200).json(ResponseHandler.updated(updated));
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error updating subject", error));
    }
};
