import express from "express";
import { createExam, deleteAllExams, deleteExam, getExams, getExamsForFilter, updateExam } from "../controllers/exam.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(getExams)
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createExam)
    .delete(canDelete, deleteAllExams);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateExam)
    .delete(canDelete, deleteExam);
router.route("/filter")
    .get(getExamsForFilter)

export default router;