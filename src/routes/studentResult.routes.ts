import express from "express";
import multer from "multer";
import { createAllResults, deleteResults, getStudentResults, updateStudentResult, deleteStudentResult, importLegacyResults } from "../controllers/studentResult.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/temp/", limits: { fileSize: 50 * 1024 * 1024 } });

router.route("/").get(authMiddleware([]), getStudentResults);
router.route("/import-json")
    .post(authMiddleware(["superadmin", "admin"]), upload.single("file"), importLegacyResults);
router.route("/upload")
    .post(authMiddleware(["superadmin", "admin"]), upload.single("file"), createAllResults);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateStudentResult)
    .delete(canDelete, deleteStudentResult);
router.route("/exam/:examId")
    .delete(authMiddleware(["superadmin", "admin"]), deleteResults);

export default router;