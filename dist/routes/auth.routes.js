"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.get("/check-role/:id", auth_controller_1.checkRole);
router.post("/login", auth_controller_1.login);
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
