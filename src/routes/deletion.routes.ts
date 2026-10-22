import express from "express";
import { listDeletionBatches, restoreDeletionBatch } from "../controllers/deletion.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// «Silinənlər»: admin and superadmin only, same audience as the delete itself (canDelete). No role scoping — region /
// district representatives and directors never get here.
router.route("/").get(authMiddleware(["admin", "superadmin"]), listDeletionBatches);
router.route("/:id/restore").post(authMiddleware(["admin", "superadmin"]), restoreDeletionBatch);

export default router;
