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
    .get(auth_middleware_1.allRegisteredRoles, userSettings_controller_1.getUserSettings)
    .put(auth_middleware_1.allRegisteredRoles, userSettings_controller_1.updateUserSettings);
exports.default = router;
