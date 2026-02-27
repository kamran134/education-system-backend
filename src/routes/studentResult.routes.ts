import express from "express";
import multer from "multer";
import { createAllResults, deleteResults, getStudentResults, updateStudentResult, deleteStudentResult, importLegacyResults } from "../controllers/studentResult.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/").get(authMiddleware([]), getStudentResults);
router.route("/import-json")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin"]), importLegacyResults);
router.route("/upload")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin"]), createAllResults);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateStudentResult)
    .delete(canDelete, deleteStudentResult);
router.route("/exam/:examId")
    .delete(authMiddleware(["superadmin", "admin"]), deleteResults);

export default router;