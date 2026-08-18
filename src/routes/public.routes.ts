import express from "express";
import { PublicController } from "../controllers/public.controller";
import { CertificateController } from "../controllers/certificate.controller";
import { verifyLimiter } from "./certificate.routes";

const router = express.Router();
const controller = new PublicController();
const certificateController = new CertificateController();

// Публичный лендинг (education-system-front/src/app/features/landing) — без авторизации,
// намеренно. Только агрегированные счётчики, см. LANDING_TASK.md §6.
router.route("/summary").get(controller.getSummary);

// Проверка подлинности сертификата по QR — без авторизации, намеренно (CERTIFICATES_TASK.md
// §7/§10). Поиск только по неугадываемому verify_token, не по номеру — иначе базу
// можно перебрать. Rate-limit против брутфорса токена.
router.route("/certificates/:token").get(verifyLimiter, certificateController.verifyByToken);

export default router;
