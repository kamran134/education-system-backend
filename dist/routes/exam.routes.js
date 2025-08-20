"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const exam_controller_1 = require("../controllers/exam.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.route("/")
    .get(exam_controller_1.getExams)
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), exam_controller_1.createExam)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), exam_controller_1.deleteAllExams);
router.route("/:id")
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), exam_controller_1.deleteExam);
router.route("/filter")
    .get(exam_controller_1.getExamsForFilter);
exports.default = router;
