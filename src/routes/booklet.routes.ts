import express from "express";
import multer from "multer";
import {
    getBooklets,
    getBookletById,
    createBooklet,
    updateBooklet,
    deleteBooklet,
    uploadBooklets,
} from "../controllers/booklet.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/")
    .get(authMiddleware([]), getBooklets)
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createBooklet);

router.route("/upload")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin", "moderator"]), uploadBooklets);

// Public route — no auth required
router.route("/public/:id")
    .get(getBookletById);

router.route("/:id")
    .get(authMiddleware([]), getBookletById)
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateBooklet)
    .delete(canDelete, deleteBooklet);

export default router;