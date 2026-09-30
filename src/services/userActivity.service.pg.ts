import { sql, RawBuilder } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions } from "../types/common.types";

/** A user counts as "online" if last_seen_at (bumped by activity.middleware.ts) is within this window. */
export const ONLINE_WINDOW_MINUTES = 5;

/** All day boundaries are computed in the Baku timezone. */
const TZ_LIT = sql.lit("Asia/Baku");

/** Display order of roles in the by-role table. */
const ROLE_ORDER = [
    "schoolDirector",
    "teacher",
    "districtRepresenter",
    "regionRepresenter",
    "admin",
    "superadmin",
    "moderator",
    "student",
];

export type ActivityStatus = "never" | "online" | "all";

export interface RoleStats {
    role: string;
    total: number;
    everLoggedIn: number;
    neverLoggedIn: number;
    last24h: number;
    last7d: number;
    last30d: number;
    onlineNow: number;
}

export interface DistrictStats {
    districtId: number;
    districtName: string;
    regionName: string;
    directorsTotal: number;
    directorsLoggedIn: number;
    teachersTotal: number;
    teachersLoggedIn: number;
    onlineNow: number;
}

export interface LoginsByDay {
    day: string;
    logins: number;
    uniqueUsers: number;
}

export interface ActivityStats {
    generatedAt: string;
    onlineWindowMinutes: number;
    loginEventsSince: string | null;
    totals: RoleStats;
    byRole: RoleStats[];
    byDistrict: DistrictStats[];
    loginsByDay: LoginsByDay[];
}

export interface ActivityUserItem {
    id: number;
    email: string;
    role: string;
    districtName: string | null;
    schoolName: string | null;
    teacherName: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
}

export interface ActivityUsersQuery {
    status: ActivityStatus;
    role?: string;
    districtId?: number;
    search?: string;
}

const toIso = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    return v instanceof Date ? v.toISOString() : new Date(v as string).toISOString();
};

/**
 * Users' district: only districtRepresenter has users.district_id; directors reach it via
 * schools, teachers via teachers.district_id (or their school as a last resort).
 * Expects aliases: u (users), s (schools by u.school_id), t (teachers), ts (schools by t.school_id).
 */
const USER_DISTRICT_ID = sql`COALESCE(u.district_id, s.district_id, t.district_id, ts.district_id)`;

const USER_JOINS = sql`
    LEFT JOIN schools s ON s.id = u.school_id
    LEFT JOIN teachers t ON t.id = u.teacher_id
    LEFT JOIN schools ts ON ts.id = t.school_id
`;

const ROLE_STATS_COLUMNS = sql`
    count(*)::int AS "total",
    count(*) FILTER (WHERE u.last_login_at IS NOT NULL)::int AS "everLoggedIn",
    count(*) FILTER (WHERE u.last_login_at IS NULL)::int AS "neverLoggedIn",
    count(*) FILTER (WHERE u.last_login_at > now() - interval '1 day')::int AS "last24h",
    count(*) FILTER (WHERE u.last_login_at > now() - interval '7 days')::int AS "last7d",
    count(*) FILTER (WHERE u.last_login_at > now() - interval '30 days')::int AS "last30d",
    count(*) FILTER (WHERE u.last_seen_at > now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES}))::int AS "onlineNow"
`;

export class UserActivityServicePg {
    async getStats(): Promise<ActivityStats> {
        const [totalsRes, byRoleRes, byDistrictRes, byDayRes, sinceRes] = await Promise.all([
            sql<Omit<RoleStats, "role">>`SELECT ${ROLE_STATS_COLUMNS} FROM users u`.execute(pg),
            sql<RoleStats>`
                SELECT u.role AS "role", ${ROLE_STATS_COLUMNS}
                FROM users u
                GROUP BY u.role
            `.execute(pg),
            sql<DistrictStats>`
                SELECT
                    d.id AS "districtId",
                    d.name AS "districtName",
                    r.name AS "regionName",
                    count(*) FILTER (WHERE u.role = 'schoolDirector')::int AS "directorsTotal",
                    count(*) FILTER (WHERE u.role = 'schoolDirector' AND u.last_login_at IS NOT NULL)::int AS "directorsLoggedIn",
                    count(*) FILTER (WHERE u.role = 'teacher')::int AS "teachersTotal",
                    count(*) FILTER (WHERE u.role = 'teacher' AND u.last_login_at IS NOT NULL)::int AS "teachersLoggedIn",
                    count(*) FILTER (WHERE u.last_seen_at > now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES}))::int AS "onlineNow"
                FROM users u
                ${USER_JOINS}
                JOIN districts d ON d.id = ${USER_DISTRICT_ID}
                JOIN regions r ON r.id = d.region_id
                WHERE u.role IN ('teacher', 'schoolDirector')
                GROUP BY d.id, d.name, r.name
                ORDER BY d.name COLLATE az_ci
            `.execute(pg),
            sql<{ day: string; logins: number; uniqueUsers: number }>`
                WITH days AS (
                    SELECT generate_series(
                        ((now() AT TIME ZONE ${TZ_LIT})::date - 29),
                        (now() AT TIME ZONE ${TZ_LIT})::date,
                        interval '1 day'
                    )::date AS day
                ),
                ev AS (
                    SELECT (logged_in_at AT TIME ZONE ${TZ_LIT})::date AS day,
                           count(*)::int AS logins,
                           count(DISTINCT user_id)::int AS unique_users
                    FROM user_login_events
                    WHERE logged_in_at >= ((now() AT TIME ZONE ${TZ_LIT})::date - 29)::timestamp AT TIME ZONE ${TZ_LIT}
                    GROUP BY 1
                )
                SELECT to_char(days.day, 'YYYY-MM-DD') AS "day",
                       COALESCE(ev.logins, 0)::int AS "logins",
                       COALESCE(ev.unique_users, 0)::int AS "uniqueUsers"
                FROM days
                LEFT JOIN ev ON ev.day = days.day
                ORDER BY days.day
            `.execute(pg),
            sql<{ since: Date | null }>`SELECT min(logged_in_at) AS "since" FROM user_login_events`.execute(pg),
        ]);

        const totalsRow = totalsRes.rows[0];
        const totals: RoleStats = {
            role: "all",
            total: totalsRow?.total ?? 0,
            everLoggedIn: totalsRow?.everLoggedIn ?? 0,
            neverLoggedIn: totalsRow?.neverLoggedIn ?? 0,
            last24h: totalsRow?.last24h ?? 0,
            last7d: totalsRow?.last7d ?? 0,
            last30d: totalsRow?.last30d ?? 0,
            onlineNow: totalsRow?.onlineNow ?? 0,
        };

        const rank = (role: string) => {
            const i = ROLE_ORDER.indexOf(role);
            return i === -1 ? ROLE_ORDER.length : i;
        };
        const byRole = byRoleRes.rows
            .filter((r) => r.total > 0)
            .sort((a, b) => rank(a.role) - rank(b.role));

        return {
            generatedAt: new Date().toISOString(),
            onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
            loginEventsSince: toIso(sinceRes.rows[0]?.since),
            totals,
            byRole,
            byDistrict: byDistrictRes.rows,
            loginsByDay: byDayRes.rows.map((r) => ({ day: r.day, logins: r.logins, uniqueUsers: r.uniqueUsers })),
        };
    }

    async getUsers(
        query: ActivityUsersQuery,
        pagination: PaginationOptions
    ): Promise<{ items: ActivityUserItem[]; total: number }> {
        const conditions: RawBuilder<unknown>[] = [];

        if (query.status === "never") {
            conditions.push(sql`u.last_login_at IS NULL`);
        } else if (query.status === "online") {
            conditions.push(sql`u.last_seen_at > now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES})`);
        }
        if (query.role) {
            conditions.push(sql`u.role = ${query.role}`);
        }
        if (query.districtId !== undefined) {
            conditions.push(sql`${USER_DISTRICT_ID} = ${query.districtId}`);
        }
        if (query.search) {
            const escaped = query.search.replace(/[\\%_]/g, (c) => "\\" + c);
            conditions.push(sql`u.email ILIKE ${"%" + escaped + "%"} ESCAPE '\\'`);
        }

        const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

        const orderBy =
            query.status === "never"
                ? sql`ORDER BY d.name COLLATE az_ci ASC NULLS LAST, COALESCE(s.name, ts.name) COLLATE az_ci ASC NULLS LAST, u.id`
                : query.status === "online"
                    ? sql`ORDER BY u.last_seen_at DESC NULLS LAST, u.id`
                    : sql`ORDER BY u.last_login_at DESC NULLS LAST, u.id`;

        const from = sql`
            FROM users u
            ${USER_JOINS}
            LEFT JOIN districts d ON d.id = ${USER_DISTRICT_ID}
        `;

        const [itemsRes, countRes] = await Promise.all([
            sql<{
                id: number;
                email: string;
                role: string;
                districtName: string | null;
                schoolName: string | null;
                teacherName: string | null;
                lastLoginAt: Date | null;
                lastSeenAt: Date | null;
                createdAt: Date;
            }>`
                SELECT u.id AS "id",
                       u.email AS "email",
                       u.role AS "role",
                       d.name AS "districtName",
                       COALESCE(s.name, ts.name) AS "schoolName",
                       t.fullname AS "teacherName",
                       u.last_login_at AS "lastLoginAt",
                       u.last_seen_at AS "lastSeenAt",
                       u.created_at AS "createdAt"
                ${from}
                ${where}
                ${orderBy}
                LIMIT ${pagination.size} OFFSET ${pagination.skip}
            `.execute(pg),
            sql<{ total: number }>`SELECT count(*)::int AS "total" ${from} ${where}`.execute(pg),
        ]);

        const items: ActivityUserItem[] = itemsRes.rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: r.role,
            districtName: r.districtName,
            schoolName: r.schoolName,
            teacherName: r.teacherName,
            lastLoginAt: toIso(r.lastLoginAt),
            lastSeenAt: toIso(r.lastSeenAt),
            createdAt: toIso(r.createdAt) as string,
        }));

        return { items, total: countRes.rows[0]?.total ?? 0 };
    }
}

export const userActivityServicePg = new UserActivityServicePg();
