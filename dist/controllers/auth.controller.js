"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.checkRole = exports.approveUser = exports.register = exports.me = exports.refreshToken = exports.login = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_validator_1 = require("express-validator");
const user_model_1 = __importDefault(require("../models/user.model"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "superrefreshsecret";
// Хранилище refresh токенов (в продакшене должно быть в Redis/DB)
const refreshTokens = new Set();
const generateTokens = (userId, role) => {
    const accessToken = jsonwebtoken_1.default.sign({ userId, role }, JWT_SECRET, { expiresIn: "15m" } // Короткий срок для access token
    );
    const refreshToken = jsonwebtoken_1.default.sign({ userId, role }, JWT_REFRESH_SECRET, { expiresIn: "7d" } // Долгий срок для refresh token
    );
    return { accessToken, refreshToken };
};
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password } = req.body;
    try {
        const user = yield user_model_1.default.findOne({ email });
        if (!user || !(yield bcrypt_1.default.compare(password, user.passwordHash))) {
            res.status(400).json({
                success: false,
                message: "Yanlış məlumatlar!"
            });
            return;
        }
        if (!(user === null || user === void 0 ? void 0 : user.isApproved)) {
            res.status(403).json({
                success: false,
                message: "Adminin təsdiqi mütləqdir!"
            });
            return;
        }
        const { accessToken, refreshToken } = generateTokens(String(user._id), user.role);
        // Сохраняем refresh token
        refreshTokens.add(refreshToken);
        // Устанавливаем refresh token в httpOnly cookie
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
            path: "/"
        });
        res.json({
            success: true,
            message: "Uğurlu avtorizasiya",
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role,
                    isApproved: user.isApproved
                },
                token: accessToken
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Serverdə xəta!"
        });
        console.error(error);
    }
});
exports.login = login;
// Новый эндпоинт для обновления токена
const refreshToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { refreshToken } = req.cookies;
    if (!refreshToken || !refreshTokens.has(refreshToken)) {
        res.status(401).json({
            success: false,
            message: "Refresh token yoxdur və ya düzgün deyil!"
        });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_REFRESH_SECRET);
        // Проверяем, что пользователь все еще существует и активен
        const user = yield user_model_1.default.findById(decoded.userId);
        if (!user || !user.isApproved) {
            refreshTokens.delete(refreshToken);
            res.clearCookie("refreshToken");
            res.status(401).json({
                success: false,
                message: "İstifadəçi tapılmadı və ya aktiv deyil!"
            });
            return;
        }
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId, decoded.role);
        // Удаляем старый и добавляем новый refresh token
        refreshTokens.delete(refreshToken);
        refreshTokens.add(newRefreshToken);
        // Обновляем refresh token cookie
        res.cookie("refreshToken", newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: "/"
        });
        res.json({
            success: true,
            data: {
                token: accessToken
            }
        });
    }
    catch (error) {
        refreshTokens.delete(refreshToken);
        res.clearCookie("refreshToken");
        res.status(401).json({
            success: false,
            message: "Düzgün olmayan refresh token!"
        });
    }
});
exports.refreshToken = refreshToken;
// Эндпоинт для проверки текущего пользователя
const me = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = yield user_model_1.default.findById((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId).select("-passwordHash");
        if (!user) {
            res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı!"
            });
            return;
        }
        res.json({
            success: true,
            data: {
                id: user._id,
                email: user.email,
                role: user.role,
                isApproved: user.isApproved
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Serverdə xəta!"
        });
    }
});
exports.me = me;
const register = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password, role } = req.body;
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    try {
        const existingUser = yield user_model_1.default.findOne({ email });
        if (existingUser) {
            res.status(400).json({ message: "İstifadəçi artıq mövcuddur!" });
            return;
        }
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        if (!password || typeof password !== "string" || password.trim().length < 6) {
            res.status(400).json({ message: "Parol təqdim edilməyib və ya düzgün formatda deyil!" });
            return;
        }
        const passwordHash = yield bcrypt_1.default.hash(password.toString(), 10);
        const newUser = new user_model_1.default({
            email, passwordHash, role: role || 'user', isApproved: role === "superadmin"
        });
        yield newUser.save();
        res.status(201).json({ message: "İstifadəçi qeydiyyatdan keçdi. Təsdiq gözlənilir." });
    }
    catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
});
exports.register = register;
const approveUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const user = yield user_model_1.default.findByIdAndUpdate(id, { isApproved: true }, { new: true });
        if (!user) {
            res.status(404).json({ message: "İstifadəçi tapılmadı!" });
            return;
        }
        res.json({ message: "İstifadəçi təsdiq edildi!", user });
    }
    catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
});
exports.approveUser = approveUser;
const checkRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.params.id;
    console.log("Checking role for user ID:", userId);
    if (!userId) {
        res.status(401).json({ message: "İstifadəçi tapılmadı!" });
        return;
    }
    const role = yield user_model_1.default.findById(userId).select("role");
    if (!role) {
        res.status(404).json({ message: "İstifadəçi rolu tapılmadı!" });
        return;
    }
    res.json({ role: role.role });
});
exports.checkRole = checkRole;
const logout = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { refreshToken } = req.cookies;
        if (refreshToken) {
            refreshTokens.delete(refreshToken);
        }
        res.clearCookie("refreshToken");
        res.json({
            success: true,
            message: "Çıxış edildi!"
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Çıxış zamanı xəta!"
        });
        console.error(error);
    }
});
exports.logout = logout;
