import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { CertificateController } from "../controllers/certificate.controller";
import { authMiddleware } from "../middleware/auth.middleware";

// Картинка шаблона идёт прямо в certificate-template.service.ts (sharp), файл на диск
// не кладём — только буфер в памяти, никакого uploads/temp здесь не нужно.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

const verifyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

const router = express.Router();
const controller = new CertificateController();
const ADMIN_ROLES = ["superadmin", "admin"];

// ---- Админ: конструктор шаблонов ----
router
    .route("/templates")
    .get(authMiddleware(ADMIN_ROLES), controller.listTemplates)
    .post(authMiddleware(ADMIN_ROLES), upload.single("image"), controller.createTemplate);

// Объявлен ДО "/templates/:id" — иначе Express уведёт "default-layout" в :id.
router.route("/templates/default-layout").get(authMiddleware(ADMIN_ROLES), controller.getDefaultLayout);

router
    .route("/templates/:id")
    .get(authMiddleware(ADMIN_ROLES), controller.getTemplate)
    .put(authMiddleware(ADMIN_ROLES), controller.updateTemplate)
    .delete(authMiddleware(ADMIN_ROLES), controller.deleteTemplate);

router
    .route("/templates/:id/image")
    .post(authMiddleware(ADMIN_ROLES), upload.single("image"), controller.replaceTemplateImage);

router.route("/templates/:id/preview").post(authMiddleware(ADMIN_ROLES), controller.previewTemplate);

// Раскладка source-шаблона, отмасштабированная под :id — не сохраняет, только считает.
// Путь длиннее "/templates/:id", с ним не конфликтует (см. CERTIFICATE_LAYOUT_REUSE_TASK.md).
router.route("/templates/:id/layout-from/:sourceId").get(authMiddleware(ADMIN_ROLES), controller.getLayoutFrom);

// ---- Админ: выданные сертификаты ----
router.route("/issued").get(authMiddleware(ADMIN_ROLES), controller.listIssued);
router.route("/issued/:id/revoke").post(authMiddleware(ADMIN_ROLES), controller.revokeIssued);

// ---- Скачивание — тот же доступ, что и GET /api/students/:id (authMiddleware([])) ----
router.route("/result/:studentResultId/:awardCode").get(authMiddleware([]), controller.downloadForResult);
router.route("/availability/student/:studentId").get(authMiddleware([]), controller.availabilityForStudent);

export default router;
export { verifyLimiter };
