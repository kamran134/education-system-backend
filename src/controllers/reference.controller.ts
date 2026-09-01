import { Request, Response } from "express";
import { pg } from "../config/pg";
import { getLevelsCache } from "../services/levels.cache";
import { getRatingYearState } from "../services/ratingYear.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

export const getLevelsReference = async (req: Request, res: Response): Promise<void> => {
    try {
        const levels = getLevelsCache().map((l) => ({
            code: l.code,
            nameAz: l.nameAz,
            rank: l.rank,
            participationScore: l.participationScore,
            minTotalScore: l.minTotalScore,
            maxTotalScore: l.maxTotalScore,
        }));
        res.status(200).json(ResponseHandler.success(levels));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching levels reference", error));
    }
};

export const getSubjectsReference = async (req: Request, res: Response): Promise<void> => {
    try {
        const rows = await pg
            .selectFrom("subjects")
            .select(["code", "name_az", "result_column", "count_column", "min_grade", "max_grade", "sort_order"])
            .where("active", "=", true)
            .orderBy("sort_order", "asc")
            .execute();

        const subjects = rows.map((r) => ({
            code: r.code,
            nameAz: r.name_az,
            resultColumn: r.result_column,
            countColumn: r.count_column,
            minGrade: r.min_grade,
            maxGrade: r.max_grade,
            sortOrder: r.sort_order,
        }));
        res.status(200).json(ResponseHandler.success(subjects));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching subjects reference", error));
    }
};

/**
 * REYTINQ_ILI_TASK.md §4 — год, за который сейчас показываются баллы на главных, нужен всем
 * ролям (подпись на профильных страницах), поэтому роль здесь пустая, как у /levels и /subjects.
 * Переключение доступно только админам — см. PUT /api/academic-year/rating-year.
 */
export const getRatingYearReference = async (req: Request, res: Response): Promise<void> => {
    try {
        const state = await getRatingYearState();
        res.status(200).json(ResponseHandler.success(state));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching rating year reference", error));
    }
};
