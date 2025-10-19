"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const stat_controller_1 = require("../controllers/stat.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.route("/").post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), stat_controller_1.updateStatistics);
router.route("/students").get(stat_controller_1.getStudentsStatistics);
router.route("/students/developing").get(stat_controller_1.getDevelopingStudents);
router.route("/students/month").get(stat_controller_1.getStudentsOfMonth);
router.route("/students/month-republic").get(stat_controller_1.getStudentsOfMonthByRepublic);
router.route("/by-exam/:examId").get(stat_controller_1.getStatisticsByExam);
router.route("/teachers").get(stat_controller_1.getTeacherStatistics);
router.route("/schools").get(stat_controller_1.getSchoolStatistics);
router.route("/districts").get(stat_controller_1.getDistrictStatistics);
exports.default = router;
