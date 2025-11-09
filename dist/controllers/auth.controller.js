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
exports.forceCleanupTokens = exports.getTokenStatistics = exports.getActiveSessions = exports.logoutFromAllDevices = exports.logout = exports.checkRole = exports.approveUser = exports.register = exports.me = exports.refreshToken = exports.login = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_validator_1 = require("express-validator");
const user_model_1 = __importDefault(require("../models/user.model"));
const token_service_1 = __importDefault(require("../services/token.service"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "superrefreshsecret";
// Refresh токены теперь хранятся в MongoDB в коллекции пользователей
const generateTokens = (userId, role, districtId, schoolId, teacherId, studentId) => {
    const payload = { userId, role };
    // Add entity IDs based on role
    if (districtId)
        payload.districtId = districtId;
    if (schoolId)
        payload.schoolId = schoolId;
    if (teacherId)
        payload.teacherId = teacherId;
    if (studentId)
        payload.studentId = studentId;
    const accessToken = jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: "15m" } // Короткий срок для access token
    );
    const refreshToken = jsonwebtoken_1.default.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" } // Долгий срок для refresh token
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
        const { accessToken, refreshToken } = generateTokens(String(user._id), user.role, user.districtId ? String(user.districtId) : undefined, user.schoolId ? String(user.schoolId) : undefined, user.teacherId ? String(user.teacherId) : undefined, user.studentId ? String(user.studentId) : undefined);
        console.log('[LOGIN] Generated tokens for user:', user.email);
        // Сохраняем refresh token в базе данных и обновляем время последнего входа
        yield user_model_1.default.findByIdAndUpdate(user._id, {
            $push: { refreshTokens: refreshToken },
            lastLoginAt: new Date()
        });
        console.log('[LOGIN] Saved refresh token to database');
        // Ограничиваем количество активных сессий (максимум 5 устройств)
        yield token_service_1.default.limitUserTokens(String(user._id), 5);
        // Устанавливаем refresh token в httpOnly cookie
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
            path: "/"
        };
        // В production указываем domain для работы с поддоменами
        if (process.env.NODE_ENV === "production") {
            cookieOptions.domain = ".kpm.az";
        }
        // В development НЕ указываем domain - так cookie будет работать для всех портов localhost
        res.cookie("refreshToken", refreshToken, cookieOptions);
        console.log('[LOGIN] Set refresh token cookie with sameSite:', process.env.NODE_ENV === "production" ? "none" : "lax");
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
    console.log('[REFRESH TOKEN] Request received, token exists:', !!refreshToken);
    if (!refreshToken) {
        console.log('[REFRESH TOKEN] No refresh token found in cookies');
        res.status(401).json({
            success: false,
            message: "Refresh token yoxdur və ya düzgün deyil!"
        });
        return;
    }
    // Проверяем токен в базе данных
    const userWithToken = yield user_model_1.default.findOne({ refreshTokens: refreshToken });
    console.log('[REFRESH TOKEN] User found with token:', !!userWithToken);
    if (!userWithToken) {
        console.log('[REFRESH TOKEN] No user found with this refresh token');
        res.status(401).json({
            success: false,
            message: "Refresh token yoxdur və ya düzgün deyil!"
        });
        return;
    }
    try {
        console.log('[REFRESH TOKEN] Verifying token...');
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_REFRESH_SECRET);
        console.log('[REFRESH TOKEN] Token verified, user ID:', decoded.userId);
        // Проверяем, что пользователь все еще существует и активен (дополнительная проверка)
        if (!userWithToken.isApproved) {
            // Удаляем токен из базы данных
            yield user_model_1.default.findByIdAndUpdate(userWithToken._id, {
                $pull: { refreshTokens: refreshToken }
            });
            const clearOptions = { path: "/" };
            if (process.env.NODE_ENV === "production") {
                clearOptions.domain = ".kpm.az";
            }
            res.clearCookie("refreshToken", clearOptions);
            res.status(401).json({
                success: false,
                message: "İstifadəçi aktiv deyil!"
            });
            return;
        }
        console.log('[REFRESH TOKEN] Generating new tokens...');
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(String(userWithToken._id), userWithToken.role, userWithToken.districtId ? String(userWithToken.districtId) : undefined, userWithToken.schoolId ? String(userWithToken.schoolId) : undefined, userWithToken.teacherId ? String(userWithToken.teacherId) : undefined, userWithToken.studentId ? String(userWithToken.studentId) : undefined);
        console.log('[REFRESH TOKEN] Updating tokens in database...');
        // Сначала удаляем старый refresh token
        yield user_model_1.default.findByIdAndUpdate(userWithToken._id, {
            $pull: { refreshTokens: refreshToken }
        });
        // Затем добавляем новый refresh token
        yield user_model_1.default.findByIdAndUpdate(userWithToken._id, {
            $push: { refreshTokens: newRefreshToken }
        });
        console.log('[REFRESH TOKEN] Setting new refresh token cookie...');
        // Обновляем refresh token cookie
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: "/"
        };
        if (process.env.NODE_ENV === "production") {
            cookieOptions.domain = ".kpm.az";
        }
        res.cookie("refreshToken", newRefreshToken, cookieOptions);
        console.log('[REFRESH TOKEN] Sending successful response...');
        res.json({
            success: true,
            data: {
                token: accessToken
            }
        });
    }
    catch (error) {
        console.log('[REFRESH TOKEN] Error occurred:', error);
        console.log('[REFRESH TOKEN] Error message:', error instanceof Error ? error.message : 'Unknown error');
        console.log('[REFRESH TOKEN] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        // Удаляем некорректный токен из базы данных
        if (userWithToken) {
            yield user_model_1.default.findByIdAndUpdate(userWithToken._id, {
                $pull: { refreshTokens: refreshToken }
            });
        }
        const clearOptions = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }
        res.clearCookie("refreshToken", clearOptions);
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
            // Удаляем токен из базы данных
            yield user_model_1.default.updateOne({ refreshTokens: refreshToken }, { $pull: { refreshTokens: refreshToken } });
        }
        const clearOptions = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }
        res.clearCookie("refreshToken", clearOptions);
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
// Выход из всех устройств (удаляет все refresh токены пользователя)
const logoutFromAllDevices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId; // Из middleware авторизации
        if (!userId) {
            res.status(401).json({
                success: false,
                message: "Avtorizasiya tələb olunur!"
            });
            return;
        }
        // Удаляем все refresh токены пользователя
        yield user_model_1.default.findByIdAndUpdate(userId, {
            $set: { refreshTokens: [] }
        });
        const clearOptions = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }
        res.clearCookie("refreshToken", clearOptions);
        res.json({
            success: true,
            message: "Bütün cihazlardan çıxış edildi!"
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
exports.logoutFromAllDevices = logoutFromAllDevices;
// Получить информацию об активных сессиях
const getActiveSessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        if (!userId) {
            res.status(401).json({
                success: false,
                message: "Avtorizasiya tələb olunur!"
            });
            return;
        }
        const user = yield user_model_1.default.findById(userId).select('refreshTokens lastLoginAt');
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
                activeSessionsCount: ((_b = user.refreshTokens) === null || _b === void 0 ? void 0 : _b.length) || 0,
                lastLoginAt: user.lastLoginAt,
                currentSession: !!req.cookies.refreshToken
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Sessiya məlumatları alınarkən xəta!"
        });
        console.error(error);
    }
});
exports.getActiveSessions = getActiveSessions;
// Админский эндпоинт для статистики токенов
const getTokenStatistics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const stats = yield token_service_1.default.getTokenStatistics();
        res.json({
            success: true,
            data: stats
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Token statistikası alınarkən xəta!"
        });
        console.error(error);
    }
});
exports.getTokenStatistics = getTokenStatistics;
// Админский эндпоинт для принудительной очистки токенов
const forceCleanupTokens = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield token_service_1.default.cleanupExpiredTokens();
        res.json({
            success: true,
            message: "Köhnə tokenlər təmizləndi!"
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Token təmizlənməsi zamanı xəta!"
        });
        console.error(error);
    }
});
exports.forceCleanupTokens = forceCleanupTokens;
