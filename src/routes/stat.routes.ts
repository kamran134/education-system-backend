import express from "express";
import { 
    getSchoolStatistics, 
    getStudentsStatistics, 
    getDevelopingStudents,
    getStudentsOfMonth,
    getStudentsOfMonthByRepublic,
    getStatisticsByExam, 
    getTeacherStatistics, 
    updateStatistics,
    updateAllStatistics, 
    getDistrictStatistics,
    migrateRatings
} from "../controllers/stat.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/").post(authMiddleware(["superadmin", "admin"]), updateStatistics);
router.route("/all").post(authMiddleware(["superadmin", "admin"]), updateAllStatistics);
router.route("/migrate-ratings").post(authMiddleware(["superadmin"]), migrateRatings);
router.route("/students").get(authMiddleware([]), getStudentsStatistics);
router.route("/students/developing").get(authMiddleware([]), getDevelopingStudents);
router.route("/students/month").get(authMiddleware([]), getStudentsOfMonth);
router.route("/students/month-republic").get(authMiddleware([]), getStudentsOfMonthByRepublic);
router.route("/by-exam/:examId").get(authMiddleware([]), getStatisticsByExam);
router.route("/teachers").get(authMiddleware([]), getTeacherStatistics);
router.route("/schools").get(authMiddleware([]), getSchoolStatistics);
router.route("/districts").get(authMiddleware([]), getDistrictStatistics);

export default router;