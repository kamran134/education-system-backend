import express from "express";
import { createAllDistricts, createDistrict, deleteDistrict, getDistricts, updateDistrictsStats } from "../controllers/district.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(getDistricts)
    .post(authMiddleware(["superadmin", "admin"]), createDistrict);
router.route("/addAll")
    .post(authMiddleware(["superadmin", "admin"]), createAllDistricts);
router.route("/:id")
    .delete(authMiddleware(["superadmin", "admin"]), deleteDistrict);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateDistrictsStats);

export default router;