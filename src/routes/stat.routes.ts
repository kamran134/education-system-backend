import express from "express";
import { getSchoolStatistics, getStudentsStatistics, getStatisticsByExam, getTeacherStatistics, updateStatistics, getDistrictStatistics } from "../controllers/stat.controller";

const router = express.Router();

router.route("/").post(updateStatistics);
router.route("/students").get(getStudentsStatistics);
router.route("/by-exam/:examId").get(getStatisticsByExam);
router.route("/teachers").get(getTeacherStatistics);
router.route("/schools").get(getSchoolStatistics);
router.route("/districts").get(getDistrictStatistics);

export default router;