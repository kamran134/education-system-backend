import express from "express";
import { createExam, deleteAllExams, deleteExam, getExams, getExamsForFilter } from "../controllers/exam.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(getExams)
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createExam)
    .delete(canDelete, deleteAllExams);
router.route("/:id")
    .delete(canDelete, deleteExam);
router.route("/filter")
    .get(getExamsForFilter)

export default router;