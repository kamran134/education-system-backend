"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const teacher_controller_1 = require("../controllers/teacher.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ dest: "uploads/" });
router.route("/")
    .get(teacher_controller_1.getTeachers)
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.createTeacher);
router.route("/filter")
    .get(teacher_controller_1.getTeachersForFilter);
router.route("/upload")
    .post(upload.single("file"), (0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.createAllTeachers);
router.route("/repair")
    .get((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.repairTeachers);
router.route("/update-stats")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.updateTeachersStats);
router.route("/delete/:teacherIds")
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.deleteTeachers);
router.route("/:id")
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.updateTeacher)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), teacher_controller_1.deleteTeacher);
exports.default = router;
