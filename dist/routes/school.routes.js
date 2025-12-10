"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const school_controller_1 = require("../controllers/school.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ dest: "uploads/" });
router.route("/").get((0, auth_middleware_1.authMiddleware)([]), school_controller_1.getSchools).post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin", "moderator"]), school_controller_1.createSchool);
router.route("/filter").get((0, auth_middleware_1.authMiddleware)([]), school_controller_1.getSchoolsForFilter);
router.route("/search").get((0, auth_middleware_1.authMiddleware)([]), school_controller_1.getSchools); // Allow all authenticated users
router.route("/upload").post(upload.single("file"), (0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.createAllSchools);
router.route("/repair").get((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.repairSchools);
router.route("/delete/:schoolIds").delete(auth_middleware_1.canDelete, school_controller_1.deleteSchools);
router.route("/:id")
    .get((0, auth_middleware_1.authMiddleware)([]), school_controller_1.getSchoolById) // Allow all authenticated users
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin", "moderator"]), school_controller_1.updateSchool)
    .delete(auth_middleware_1.canDelete, school_controller_1.deleteSchool);
router.route("/update-stats")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.updateSchoolsStats);
exports.default = router;
