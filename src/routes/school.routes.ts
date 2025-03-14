import express from "express";
import multer from "multer";
import { createAllSchools, createSchool, deleteSchool, deleteSchools, getSchools, getSchoolsForFilter, repairSchools, updateSchool } from "../controllers/school.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/").get(getSchools).post(authMiddleware(["superadmin", "admin"]), createSchool);
router.route("/filter").get(getSchoolsForFilter);
router.route("/upload").post(upload.single("file"), authMiddleware(["superadmin", "admin"]), createAllSchools);
router.route("/repair").get(authMiddleware(["superadmin", "admin"]), repairSchools);
router.route("/delete/:schoolIds").delete(authMiddleware(["superadmin", "admin"]), deleteSchools);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin"]), updateSchool)
    .delete(authMiddleware(["superadmin", "admin"]), deleteSchool);

export default router;