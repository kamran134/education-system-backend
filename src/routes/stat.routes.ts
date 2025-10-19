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
    getDistrictStatistics 
} from "../controllers/stat.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/").post(authMiddleware(["superadmin", "admin"]), updateStatistics);
router.route("/students").get(getStudentsStatistics);
router.route("/students/developing").get(getDevelopingStudents);
router.route("/students/month").get(getStudentsOfMonth);
router.route("/students/month-republic").get(getStudentsOfMonthByRepublic);
router.route("/by-exam/:examId").get(getStatisticsByExam);
router.route("/teachers").get(getTeacherStatistics);
router.route("/schools").get(getSchoolStatistics);
router.route("/districts").get(getDistrictStatistics);

export default router;