import express from "express";
import { getStudents, getStudent, deleteAllStudents, deleteStudent, deleteStudents, searchStudents, repairStudents, updateStudent, createStudent } from "../controllers/student.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(getStudents)
    .post(authMiddleware(["superadmin", "admin"]), createStudent)
    .delete(authMiddleware(["superadmin", "admin"]), deleteAllStudents);
router.route("/repair")
    .get(authMiddleware(["superadmin", "admin"]), repairStudents);
// router.route("/forStats")
//     .get(getStudentsForStats);
router.route("/search/:searchString").get(searchStudents);
router.route("/delete/:studentIds")
    .delete(authMiddleware(["superadmin", "admin"]), deleteStudents);
router.route("/:id").get(getStudent)
    .put(authMiddleware(["superadmin", "admin"]), updateStudent)
    .delete(authMiddleware(["superadmin", "admin"]), deleteStudent);

export default router;