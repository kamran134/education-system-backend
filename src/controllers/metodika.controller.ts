import { Request, Response, NextFunction } from "express";
import { getMetodikaContent, setMetodikaContent, resetMetodikaContent } from "../services/metodika.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

/** Рекурсивно обрезает пробелы у всех строковых листьев объекта/массива. Числа и структура не трогаются. */
function trimStrings(value: any): any {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(trimStrings);
    if (value && typeof value === "object") {
        const result: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            result[key] = trimStrings(value[key]);
        }
        return result;
    }
    return value;
}

/**
 * Лёгкая валидация — не поле-в-поле по всей модели (в проекте так не принято, см. соседние
 * usecase/ValidationUtils), а только то, что реально может сломать вёрстку публичной страницы:
 * тело должно быть объектом, levels — непустой массив с корректными типами.
 * (disciplines проверялись до 20.09.2026 — карточка состава экзамена снята с публичной страницы
 * по просьбе заказчика; старые сохранённые данные с этим полем принимаются и игнорируются.)
 */
function validateMetodikaContent(body: any): string | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return "Məzmun obyekt formatında olmalıdır";
    }

    const levels = body.part1?.levels;
    if (!Array.isArray(levels) || levels.length === 0) {
        return "Ən azı bir səviyyə göstərilməlidir";
    }
    for (const l of levels) {
        if (!l?.code || typeof l.code !== "string" || !l.code.trim()) {
            return "Səviyyə kodu boş ola bilməz";
        }
        if (!l?.percent || typeof l.percent !== "string" || !l.percent.trim()) {
            return "Səviyyə faizi boş ola bilməz";
        }
    }

    return null;
}

export class MetodikaController {
    /** Без authMiddleware — публичная страница, как /api/public/summary. */
    get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const content = await getMetodikaContent();
            res.json(ResponseHandler.success({ content }));
        } catch (error) {
            next(error);
        }
    };

    put = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const validationError = validateMetodikaContent(req.body);
            if (validationError) {
                res.status(400).json(ResponseHandler.badRequest(validationError));
                return;
            }

            const sanitized = trimStrings(req.body);
            const userId = parseInt(req.user!.userId, 10);
            await setMetodikaContent(sanitized, userId);
            res.json(ResponseHandler.updated({ content: sanitized }, "Metodika səhifəsi yadda saxlanıldı"));
        } catch (error) {
            next(error);
        }
    };

    delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await resetMetodikaContent();
            res.json(ResponseHandler.success(null, "İlkin mətnə qaytarıldı"));
        } catch (error) {
            next(error);
        }
    };
}
