import { Request, Response } from "express";
import { ResponseHandler } from "../utils/response-handler.util";
import { RequestParser } from "../utils/request-parser.util";
import { DELETION_ENTITY_TYPES, DeletionEntityType, listDeletions, restoreDeletion } from "../services/deletion.service.pg";

/** «Silinənlər» — list of soft-delete batches and restore. Admin / superadmin only (checked in the routes). */
export const listDeletionBatches = async (req: Request, res: Response): Promise<void> => {
    try {
        const rawType = typeof req.query.type === "string" ? req.query.type.trim() : "";
        if (rawType && !DELETION_ENTITY_TYPES.includes(rawType as DeletionEntityType)) {
            res.status(400).json(ResponseHandler.badRequest("Yanlış növ"));
            return;
        }

        // The spec calls the page size `limit`; the rest of the API uses `size` — accept both.
        if (req.query.size === undefined && req.query.limit !== undefined) req.query.size = req.query.limit;
        const { page, size } = RequestParser.parsePagination(req);
        const search = typeof req.query.search === "string" ? req.query.search : undefined;

        const { data, totalCount } = await listDeletions({
            type: (rawType || undefined) as DeletionEntityType | undefined,
            search,
            page,
            size,
        });

        res.status(200).json(ResponseHandler.success({
            data,
            totalCount,
            page,
            size,
            totalPages: Math.max(1, Math.ceil(totalCount / size)),
        }));
    } catch (error: any) {
        console.error("Error in listDeletionBatches:", error);
        res.status(500).json(ResponseHandler.internalError("Error fetching deletions", error));
    }
};

export const restoreDeletionBatch = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json(ResponseHandler.badRequest("Yanlış identifikator"));
            return;
        }

        const restored = await restoreDeletion(id, parseInt(req.user!.userId, 10));
        res.status(200).json(ResponseHandler.success({ restored }, "Bərpa edildi"));
    } catch (error: any) {
        if (error?.status === 404) {
            res.status(404).json(ResponseHandler.notFound(error.message));
        } else if (error?.status === 409) {
            res.status(409).json(ResponseHandler.conflict(error.message));
        } else {
            console.error("Error in restoreDeletionBatch:", error);
            res.status(500).json(ResponseHandler.internalError("Error restoring deletion", error));
        }
    }
};
