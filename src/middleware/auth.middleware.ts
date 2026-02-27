import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Расширяем Request
declare global {
    namespace Express {
        interface Request {
            user?: { 
                userId: string; 
                role: string;
                districtId?: string;
                schoolId?: string;
                teacherId?: string;
                studentId?: string;
            };
        }
    }
}

export const authMiddleware = (roles: string[] = []) => (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ 
            success: false,
            message: "Access token tələb olunur" 
        });
        return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { 
            userId: string; 
            role: string;
            districtId?: string;
            schoolId?: string;
            teacherId?: string;
            studentId?: string;
        }

        // Если роли указаны, проверяем их
        if (roles.length > 0 && !roles.includes(decoded.role)) {
            res.status(403).json({ 
                success: false,
                message: "Qadağan olunub!" 
            });
            return;
        }

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false,
            message: "Düzgün olmayan token" 
        });
        console.error(error);
    }
}

export const checkAdminRole = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ 
            success: false,
            message: "Access token tələb olunur" 
        });
        return;
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { 
            userId: string; 
            role: string;
            districtId?: string;
            schoolId?: string;
            teacherId?: string;
            studentId?: string;
        }

        if (decoded.role !== "admin" && decoded.role !== "superadmin") {
            res.status(403).json({ 
                success: false,
                message: "Yalnız admin və superadminlər bu əməliyyatı edə bilər" 
            });
            return;
        }

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false,
            message: "Düzgün olmayan token" 
        });
        console.error(error);
    }
}

export const allRegisteredRoles = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            message: "Access token tələb olunur"
        });
        return;
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as {
            userId: string;
            role: string;
            districtId?: string;
            schoolId?: string;
            teacherId?: string;
            studentId?: string;
        }

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
}

/**
 * Middleware для защиты операций удаления
 * Модераторы НЕ могут удалять данные
 */
export const canDelete = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            message: "Access token tələb olunur"
        });
        return;
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as {
            userId: string;
            role: string;
            districtId?: string;
            schoolId?: string;
            teacherId?: string;
            studentId?: string;
        }

        // Только superadmin и admin могут удалять
        if (decoded.role !== "superadmin" && decoded.role !== "admin") {
            res.status(403).json({
                success: false,
                message: "Yalnız superadmin və adminlər silmə əməliyyatı edə bilər"
            });
            return;
        }

        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
}
