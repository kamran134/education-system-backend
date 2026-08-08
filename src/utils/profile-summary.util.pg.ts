import { pg } from "../config/pg";
import { User } from "../services/user.service.pg";

/**
 * Postgres-версия buildProfileSummary — см. profile-summary.util.ts (Mongo) для сравнения.
 * Форма ответа (ProfileSummary) идентична, entityId — число, не ObjectId-строка
 * (решение 04.08.2026 про формат id, PG_MIGRATION_TASKS.md шаг 8).
 */
export interface ProfileSummaryPg {
    entityId: number;
    avatarUrl?: string | null;
    fullName?: string;
    name?: string;
    grade?: number | null;
    schoolName?: string | null;
    districtName?: string | null;
    teacherName?: string | null;
}

export async function buildProfileSummaryPg(user: User): Promise<ProfileSummaryPg | null> {
    switch (user.role) {
        case "student": {
            if (!user.studentId) return null;
            const student = await pg
                .selectFrom("students")
                .leftJoin("schools", "schools.id", "students.school_id")
                .leftJoin("districts", "districts.id", "students.district_id")
                .leftJoin("teachers", "teachers.id", "students.teacher_id")
                .select([
                    "students.id as id",
                    "students.last_name as last_name",
                    "students.first_name as first_name",
                    "students.middle_name as middle_name",
                    "students.grade as grade",
                    "students.avatar_url as avatar_url",
                    "schools.name as school_name",
                    "districts.name as district_name",
                    "teachers.fullname as teacher_fullname",
                ])
                .where("students.id", "=", user.studentId)
                .executeTakeFirst();
            if (!student) return null;

            return {
                entityId: student.id,
                fullName: [student.last_name, student.first_name, student.middle_name].filter(Boolean).join(" "),
                grade: student.grade,
                avatarUrl: student.avatar_url,
                schoolName: student.school_name,
                districtName: student.district_name,
                teacherName: student.teacher_fullname,
            };
        }

        case "teacher": {
            if (!user.teacherId) return null;
            const teacher = await pg
                .selectFrom("teachers")
                .leftJoin("schools", "schools.id", "teachers.school_id")
                .leftJoin("districts", "districts.id", "teachers.district_id")
                .select([
                    "teachers.id as id",
                    "teachers.fullname as fullname",
                    "teachers.avatar_url as avatar_url",
                    "schools.name as school_name",
                    "districts.name as district_name",
                ])
                .where("teachers.id", "=", user.teacherId)
                .executeTakeFirst();
            if (!teacher) return null;

            return {
                entityId: teacher.id,
                fullName: teacher.fullname,
                avatarUrl: teacher.avatar_url,
                schoolName: teacher.school_name,
                districtName: teacher.district_name,
            };
        }

        case "schoolDirector": {
            if (!user.schoolId) return null;
            const school = await pg
                .selectFrom("schools")
                .leftJoin("districts", "districts.id", "schools.district_id")
                .select(["schools.id as id", "schools.name as name", "schools.avatar_url as avatar_url", "districts.name as district_name"])
                .where("schools.id", "=", user.schoolId)
                .executeTakeFirst();
            if (!school) return null;

            return {
                entityId: school.id,
                name: school.name,
                avatarUrl: school.avatar_url,
                districtName: school.district_name,
            };
        }

        case "districtRepresenter": {
            if (!user.districtId) return null;
            const district = await pg
                .selectFrom("districts")
                .select(["id", "name", "avatar_url"])
                .where("id", "=", user.districtId)
                .executeTakeFirst();
            if (!district) return null;

            return {
                entityId: district.id,
                name: district.name,
                avatarUrl: district.avatar_url,
            };
        }

        case "regionRepresenter": {
            if (!user.regionId) return null;
            const region = await pg
                .selectFrom("regions")
                .select(["id", "name", "avatar_url"])
                .where("id", "=", user.regionId)
                .executeTakeFirst();
            if (!region) return null;

            return {
                entityId: region.id,
                name: region.name,
                avatarUrl: region.avatar_url,
            };
        }

        default:
            return null;
    }
}
