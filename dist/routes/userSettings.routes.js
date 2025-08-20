"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const userSettings_controller_1 = require("../controllers/userSettings.controller");
const router = express_1.default.Router();
router.route('/')
    .get((0, auth_middleware_1.authMiddleware)(["superadmin", "admin", "moderator", "user"]), userSettings_controller_1.getUserSettings)
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin", "moderator", "user"]), userSettings_controller_1.updateUserSettings);
exports.default = router;
