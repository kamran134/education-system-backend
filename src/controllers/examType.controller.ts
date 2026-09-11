import { Request, Response } from "express";
import { examTypeServicePg } from "../services/examType.service.pg";
import { resultTemplateService } from "../services/resultTemplate.service";
import { ResponseHandler } from "../utils/response-handler.util";
import { ValidationUtils } from "../utils/validation.util";

export const getExamTypes = async (req: Request, res: Response): Promise<void> => {
    try {
        const data = await examTypeServicePg.findAll();
        res.status(200).json(ResponseHandler.success(data));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching exam types", error));
    }
};

export const createExamType = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code, nameAz, levelScaleId, sections } = req.body;
        const errors = [
            ValidationUtils.validateRequired(code, "code"),
            ValidationUtils.validateRequired(nameAz, "nameAz"),
            ValidationUtils.validateRequired(levelScaleId, "levelScaleId"),
        ].filter((e): e is string => e !== null);
        if (!Array.isArray(sections) || sections.length === 0) {
            errors.push("sections must be a non-empty array");
        }
        if (errors.length > 0) {
            res.status(400).json(ResponseHandler.badRequest(errors.join(", ")));
            return;
        }

        const created = await examTypeServicePg.create(req.body);
        res.status(201).json(ResponseHandler.created(created));
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error creating exam type", error));
    }
};

export const updateExamType = async (req: Request, res: Response): Promise<void> => {
    try {
        const idError = ValidationUtils.validateId(req.params.id, "id");
        if (idError) {
            res.status(400).json(ResponseHandler.badRequest(idError));
            return;
        }

        const { code, nameAz, levelScaleId, sections } = req.body;
        const errors = [
            ValidationUtils.validateRequired(code, "code"),
            ValidationUtils.validateRequired(nameAz, "nameAz"),
            ValidationUtils.validateRequired(levelScaleId, "levelScaleId"),
        ].filter((e): e is string => e !== null);
        if (!Array.isArray(sections) || sections.length === 0) {
            errors.push("sections must be a non-empty array");
        }
        if (errors.length > 0) {
            res.status(400).json(ResponseHandler.badRequest(errors.join(", ")));
            return;
        }

        const updated = await examTypeServicePg.update(parseInt(req.params.id, 10), req.body);
        res.status(200).json(ResponseHandler.updated(updated));
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error updating exam type", error));
    }
};

/**
 * GET /exam-types/:id/results-template.xlsx?sectionId=X — IMTAHAN_NOVLERI_TASK.md §18.1.
 * Шаблон резолвится напрямую по типу+секции, без экзамена (кнопка в списке типов не привязана
 * к конкретному экзамену). Права — как у GET /exam-types (любой авторизованный, §11 журнала ТЗ).
 */
export const getResultsTemplateForSection = async (req: Request, res: Response): Promise<void> => {
    try {
        const examTypeId = parseInt(req.params.id, 10);
        const sectionId = parseInt(String(req.query.sectionId), 10);

        if (isNaN(examTypeId) || isNaN(sectionId)) {
            res.status(400).json(ResponseHandler.badRequest("İmtahan növü və ya bölmə düzgün göstərilməyib"));
            return;
        }

        const { buffer, filename } = await resultTemplateService.generateForType(examTypeId, sectionId);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error generating results template", error));
    }
};

export const deleteExamType = async (req: Request, res: Response): Promise<void> => {
    try {
        const idError = ValidationUtils.validateId(req.params.id, "id");
        if (idError) {
            res.status(400).json(ResponseHandler.badRequest(idError));
            return;
        }

        await examTypeServicePg.delete(parseInt(req.params.id, 10));
        res.status(200).json(ResponseHandler.deleted());
    } catch (error: any) {
        res.status(error?.status || 500).json(ResponseHandler.internalError(error?.message || "Error deleting exam type", error));
    }
};
