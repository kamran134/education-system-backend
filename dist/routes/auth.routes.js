"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
// Строгий лимит только для логина (защита от брутфорса)
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 10, // Максимум 10 попыток логина за 15 минут
    message: { success: false, message: 'Çox sayda giriş cəhdi. Zəhmət olmasa 15 dəqiqə gözləyin.' },
    skipSuccessfulRequests: true, // Не считаем успешные попытки
    standardHeaders: true,
    legacyHeaders: false,
});
router.get("/check-role/:id", auth_controller_1.checkRole);
router.post("/login", loginLimiter, auth_controller_1.login); // Применяем строгий лимит только к login
router.post("/register", auth_controller_1.register);
router.post("/approve/:id", (0, auth_middleware_1.authMiddleware)(["superadmin"]), auth_controller_1.approveUser);
router.post("/logout", auth_controller_1.logout);
router.post("/logout-all", (0, auth_middleware_1.authMiddleware)([]), auth_controller_1.logoutFromAllDevices);
router.post("/refresh", auth_controller_1.refreshToken);
router.get("/me", (0, auth_middleware_1.authMiddleware)([]), auth_controller_1.me);
router.get("/sessions", (0, auth_middleware_1.authMiddleware)([]), auth_controller_1.getActiveSessions);
router.get("/debug-cookies", (req, res) => {
    console.log('[DEBUG] All cookies:', req.cookies);
    res.json({
        cookies: req.cookies,
        hasRefreshToken: !!req.cookies.refreshToken,
        refreshTokenLength: req.cookies.refreshToken ? req.cookies.refreshToken.length : 0
    });
});
// Админские маршруты для управления токенами
router.get("/admin/token-stats", (0, auth_middleware_1.authMiddleware)(["admin", "superadmin"]), auth_controller_1.getTokenStatistics);
router.post("/admin/cleanup-tokens", (0, auth_middleware_1.authMiddleware)(["admin", "superadmin"]), auth_controller_1.forceCleanupTokens);
exports.default = router;
