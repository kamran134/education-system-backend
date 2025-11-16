import express from "express";
import multer from "multer";
import { createAllSchools, createSchool, deleteSchool, deleteSchools, getSchoolById, getSchools, getSchoolsForFilter, repairSchools, updateSchool, updateSchoolsStats } from "../controllers/school.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/").get(authMiddleware([]), getSchools).post(authMiddleware(["superadmin", "admin", "moderator"]), createSchool);
router.route("/filter").get(authMiddleware([]), getSchoolsForFilter);
router.route("/search").get(authMiddleware([]), getSchools); // Allow all authenticated users
router.route("/upload").post(upload.single("file"), authMiddleware(["superadmin", "admin"]), createAllSchools);
router.route("/repair").get(authMiddleware(["superadmin", "admin"]), repairSchools);
router.route("/delete/:schoolIds").delete(canDelete, deleteSchools);
router.route("/:id")
    .get(authMiddleware([]), getSchoolById) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateSchool)
    .delete(canDelete, deleteSchool);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateSchoolsStats);

export default router;