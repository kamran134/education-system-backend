"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const district_controller_1 = require("../controllers/district.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.route("/")
    .get(district_controller_1.getDistricts)
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.createDistrict);
router.route("/addAll")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.createAllDistricts);
router.route("/:id")
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.deleteDistrict);
router.route("/update-stats")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.updateDistrictsStats);
exports.default = router;
