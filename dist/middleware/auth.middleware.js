"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canDelete = exports.allRegisteredRoles = exports.checkAdminRole = exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const authMiddleware = (roles = []) => (req, res, next) => {
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
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
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
    }
    catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
};
exports.authMiddleware = authMiddleware;
const checkAdminRole = (req, res, next) => {
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
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (decoded.role !== "admin" && decoded.role !== "superadmin") {
            res.status(403).json({
                success: false,
                message: "Yalnız admin və superadminlər bu əməliyyatı edə bilər"
            });
            return;
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
};
exports.checkAdminRole = checkAdminRole;
const allRegisteredRoles = (req, res, next) => {
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
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
};
exports.allRegisteredRoles = allRegisteredRoles;
/**
 * Middleware для защиты операций удаления
 * Модераторы НЕ могут удалять данные
 */
const canDelete = (req, res, next) => {
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
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Модератор НЕ может удалять
        if (decoded.role === "moderator") {
            res.status(403).json({
                success: false,
                message: "Moderatorlar silmə əməliyyatı edə bilməz"
            });
            return;
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan token"
        });
        console.error(error);
    }
};
exports.canDelete = canDelete;
