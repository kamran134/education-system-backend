import express from "express";
import { getSubjects, createSubject, updateSubject } from "../controllers/subject.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// IMTAHAN_NOVLERI_TASK.md §5.3: справочники (типы, предметы, шкалы) — admin/superadmin,
// как POST-ы /stats (см. stat.routes.ts).
router.route("/")
    .get(authMiddleware([]), getSubjects)
    .post(authMiddleware(["superadmin", "admin"]), createSubject);
router.route("/:code")
    .put(authMiddleware(["superadmin", "admin"]), updateSubject);

export default router;
