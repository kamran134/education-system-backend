import express from "express";
import { PublicController } from "../controllers/public.controller";

const router = express.Router();
const controller = new PublicController();

// Публичный лендинг (education-system-front/src/app/features/landing) — без авторизации,
// намеренно. Только агрегированные счётчики, см. LANDING_TASK.md §6.
router.route("/summary").get(controller.getSummary);

export default router;
