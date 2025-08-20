"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAdminRole = exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const authMiddleware = (roles) => (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        res.status(401).json({ message: "Avtorizasiya tələb olunur" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (!roles.includes(decoded.role)) {
            res.status(403).json({ message: "Qadağan olunub!" });
            return;
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({ message: "Invalid token" });
        console.error(error);
    }
};
exports.authMiddleware = authMiddleware;
const checkAdminRole = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        res.status(401).json({ message: "Avtorizasiya tələb olunur" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (decoded.role !== "admin" && decoded.role !== "superadmin") {
            res.status(403).json({ message: "Yalnız admin və superadminlər bu əməliyyatı edə bilər" });
            return;
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        res.status(401).json({ message: "Invalid token" });
        console.error(error);
    }
};
exports.checkAdminRole = checkAdminRole;
