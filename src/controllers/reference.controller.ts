import { Request, Response } from "express";
import { pg } from "../config/pg";
import { getBandsByScaleCode } from "../services/levels.cache";
import { getRatingYearState } from "../services/ratingYear.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

/**
 * Таблица levels снесена миграцией 026 (IMTAHAN_NOVLERI_TASK.md §20) — отдаём бэнды
 * единственной шкалы isim_percent вместо строк старого справочника. Форма ответа поменялась:
 * minTotalScore/maxTotalScore (абсолютные пороги, калибровка под 50-вопросный экзамен) заменены
 * на minPercent/maxPercent — не найдено ни одного вызывающего на фронте (проверено grep'ом),
 * ломать нечего. GET /level-scales (levelScale.controller.ts) — более полный аналог этого
 * эндпоинта (все шкалы, а не только "текущая"); этот оставлен ради обратной совместимости пути.
 */
export const getLevelsReference = async (req: Request, res: Response): Promise<void> => {
    try {
        const levels = getBandsByScaleCode("isim_percent").map((b) => ({
            code: b.code,
            nameAz: b.nameAz,
            rank: b.rank,
            participationScore: b.participationScore,
            minPercent: b.minPercent,
            maxPercent: b.maxPercent,
        }));
        res.status(200).json(ResponseHandler.success(levels));
    } catch (error) {
        res.status(500).json(ResponseHandler.internalError("Error fetching levels reference", error));
    }
};

/**
 * result_column/count_column/min_grade/max_grade убраны из subjects миграцией
 * 023_exam_types_and_level_scales.sql (они описывали колонки student_results, а не сам
 * предмет) — эти четыре поля больше не отдаются. GET /api/reference/subjects на фронте
 * никем не вызывается (проверено grep'ом), поэтому сузить ответ безопасно.
 */
export const getSubjectsReference = async (req: Request, res: Response): Promise<void> => {
    try {
        const rows = await pg
            .selectFrom("subjects")
            .select(["code", "name_az", "sort_order"])
            .where("active", "=", true)
            .orderBy("sort_order", "asc")
            .execute();

        const subjects = rows.map((r) => ({
            code: r.code,
            nameAz: r.name_az,
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
