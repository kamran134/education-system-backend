import { districtIdsOfRegion } from "./region-scope.util";

export type ViewableEntityType = "region" | "district" | "school" | "teacher" | "student";

/** Родительские ссылки ЦЕЛЕВОЙ сущности — ровно то, что уже есть на объекте, отданном findById. */
export interface ViewableEntityRefs {
    regionId?: number | null;   // у district
    districtId?: number | null; // у school/teacher/student
    schoolId?: number | null;   // у teacher/student
    teacherId?: number | null;  // у student
}

interface RequestUser {
    role?: string;
    regionId?: string;
    districtId?: string;
    schoolId?: string;
    teacherId?: string;
    studentId?: string;
}

/**
 * Иерархия просмотра профилей (найдено ревью 19.08.2026, PROFILE_AS_HOME_TASK.md):
 * каждая роль с привязанной сущностью видит СЕБЯ и весь свой поддерево ВНИЗ — и никогда
 * не выше. Учитель не видит даже свою школу, школа не видит свой район, район не видит
 * свой регион. admin/superadmin/moderator видят всё без ограничений.
 *
 * Это НЕ то же самое, что фильтры списков ("Role-based filtering" в *.controller.ts —
 * getTeachers/getSchools/...): те сужают, что попадает в СПИСОК. Эта функция решает,
 * можно ли просматривать ОДНУ конкретную сущность по id — независимо от того, как на неё
 * попали (прямой URL, брэдкрамб, карточка в drill-down). До этой функции GET .../:id у
 * всех пяти сущностей был открыт `authMiddleware([])` без какой-либо проверки владения —
 * реальная дыра, не гипотетическая: учитель мог зайти в профиль своей школы и оттуда —
 * в профиль любого другого учителя школы, хотя UI туда ссылку не давал.
 *
 * regionRepresenter — единственный случай с лишним запросом: у District/School/Teacher/
 * Student нет прямого regionId, только districtId, поэтому región раскрывается в список
 * district id через уже существующий districtIdsOfRegion (тот же приём, что в RBAC-фильтрах
 * списков).
 */
export async function canViewEntity(
    user: RequestUser | undefined,
    targetType: ViewableEntityType,
    targetId: number,
    targetRefs: ViewableEntityRefs = {}
): Promise<boolean> {
    if (!user?.role) return false;
    if (user.role === "admin" || user.role === "superadmin" || user.role === "moderator") return true;

    switch (user.role) {
        case "regionRepresenter": {
            if (!user.regionId) return false;
            const viewerRegionId = parseInt(user.regionId, 10);
            if (targetType === "region") return targetId === viewerRegionId;
            // District — единственный тип, чей targetRefs несёт regionId напрямую (см.
            // district.controller.ts), сравниваем без похода в БД.
            if (targetType === "district") return targetRefs.regionId === viewerRegionId;
            // school/teacher/student несут только districtId — региона раскрываем в список
            // district id тем же приёмом, что и в RBAC-фильтрах списков.
            if (targetRefs.districtId == null) return false;
            const districtIds = await districtIdsOfRegion(viewerRegionId);
            return districtIds.includes(targetRefs.districtId);
        }
        case "districtRepresenter": {
            if (!user.districtId) return false;
            const viewerDistrictId = parseInt(user.districtId, 10);
            if (targetType === "district") return targetId === viewerDistrictId;
            if (targetType === "region") return false;
            return targetRefs.districtId === viewerDistrictId;
        }
        case "schoolDirector": {
            if (!user.schoolId) return false;
            const viewerSchoolId = parseInt(user.schoolId, 10);
            if (targetType === "school") return targetId === viewerSchoolId;
            if (targetType === "region" || targetType === "district") return false;
            return targetRefs.schoolId === viewerSchoolId;
        }
        case "teacher": {
            if (!user.teacherId) return false;
            const viewerTeacherId = parseInt(user.teacherId, 10);
            if (targetType === "teacher") return targetId === viewerTeacherId;
            if (targetType === "student") return targetRefs.teacherId === viewerTeacherId;
            return false; // school/district/region — никогда
        }
        case "student": {
            if (!user.studentId) return false;
            return targetType === "student" && targetId === parseInt(user.studentId, 10);
        }
        default:
            return false;
    }
}
