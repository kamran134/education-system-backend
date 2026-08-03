import Student from "../models/student.model";
import Teacher from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { IUser } from "../models/user.model";

/**
 * Данные для карточки-профиля на главной странице фронта.
 * Форма ответа одна на все 4 роли — фронт сам решает, какие поля показывать.
 */
export interface ProfileSummary {
    entityId: string; // _id студента/учителя/школы/района — нужен фронту, чтобы бить в /:id/avatar
    avatarUrl?: string;
    fullName?: string;   // student, teacher
    name?: string;        // school, district (собственное имя сущности)
    grade?: number;       // student
    schoolName?: string;  // student, teacher, schoolDirector
    districtName?: string; // student, teacher, schoolDirector, districtRepresenter
    teacherName?: string;  // student
}

/**
 * Строит profile-сводку по роли пользователя. Возвращает null для ролей без
 * привязанной сущности (superadmin/admin/moderator) или если ссылка в User
 * ведёт на уже несуществующую запись.
 */
export async function buildProfileSummary(user: IUser): Promise<ProfileSummary | null> {
    switch (user.role) {
        case 'student': {
            if (!user.studentId) return null;
            const student = await Student.findById(user.studentId)
                .populate('school', 'name')
                .populate('district', 'name')
                .populate('teacher', 'fullname');
            if (!student) return null;

            return {
                entityId: student._id.toString(),
                fullName: [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' '),
                grade: student.grade,
                avatarUrl: student.avatarUrl,
                schoolName: (student.school as any)?.name,
                districtName: (student.district as any)?.name,
                teacherName: (student.teacher as any)?.fullname,
            };
        }

        case 'teacher': {
            if (!user.teacherId) return null;
            const teacher = await Teacher.findById(user.teacherId)
                .populate('school', 'name')
                .populate('district', 'name');
            if (!teacher) return null;

            return {
                entityId: teacher._id.toString(),
                fullName: teacher.fullname,
                avatarUrl: teacher.avatarUrl,
                schoolName: (teacher.school as any)?.name,
                districtName: (teacher.district as any)?.name,
            };
        }

        case 'schoolDirector': {
            if (!user.schoolId) return null;
            const school = await School.findById(user.schoolId).populate('district', 'name');
            if (!school) return null;

            return {
                entityId: school._id.toString(),
                name: school.name,
                avatarUrl: school.avatarUrl,
                districtName: (school.district as any)?.name,
            };
        }

        case 'districtRepresenter': {
            if (!user.districtId) return null;
            const district = await District.findById(user.districtId);
            if (!district) return null;

            return {
                entityId: district._id.toString(),
                name: district.name,
                avatarUrl: district.avatarUrl,
            };
        }

        default:
            return null;
    }
}
