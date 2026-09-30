-- 030_user_activity.sql
-- Date: 2026-09-30
-- Task: login/activity statistics for admins (who has logged in, who is online now).
--
-- users.last_login_at already exists but keeps only the most recent login and says nothing about
-- activity after it (access token lives 15m, refresh 7d; neither marks presence). Two additions:
--   * users.last_seen_at — touched by middleware/activity.middleware.ts on any authenticated API
--     request, throttled to at most once per minute per user. "Online now" = last_seen_at within
--     the last few minutes. NULL for everyone until their first request after this deploy.
--   * user_login_events — one row per successful login (auth.controller.ts::login), for per-day
--     charts and login counts. Starts empty: history before this migration exists only as
--     users.last_login_at, and we deliberately don't fake past events from it.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS user_login_events (
    id            bigserial PRIMARY KEY,
    user_id       bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at  timestamptz NOT NULL DEFAULT now(),
    ip            text,
    user_agent    text
);

CREATE INDEX IF NOT EXISTS user_login_events_logged_in_at_idx ON user_login_events (logged_in_at);
CREATE INDEX IF NOT EXISTS user_login_events_user_id_idx ON user_login_events (user_id, logged_in_at);

COMMIT;
