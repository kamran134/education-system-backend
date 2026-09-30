import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env";
import { pg } from "../config/pg";

// Minimum gap between two last_seen_at writes for the same user. "Online now" is judged on a
// window of several minutes, so per-minute precision is enough and keeps DB writes to ~1/min/user.
const TOUCH_INTERVAL_MS = 60 * 1000;

const lastTouched = new Map<number, number>();

/**
 * Global middleware: if the request carries a valid Bearer access token, bumps users.last_seen_at
 * (see migration 030_user_activity.sql). Never rejects or delays a request — authorization stays
 * in auth.middleware.ts; an invalid/missing token here is simply ignored.
 */
export const trackActivity = (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        try {
            const { userId } = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: string };
            const id = Number(userId);
            const now = Date.now();
            if (Number.isInteger(id) && now - (lastTouched.get(id) ?? 0) >= TOUCH_INTERVAL_MS) {
                lastTouched.set(id, now);
                pg.updateTable("users")
                    .set({ last_seen_at: new Date(now) })
                    .where("id", "=", id)
                    .execute()
                    .catch((err) => console.error("[ACTIVITY] last_seen_at update failed:", err));
            }
        } catch {
            // Expired/invalid token — the route's own auth middleware will answer 401.
        }
    }
    next();
};
