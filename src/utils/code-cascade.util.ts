import { Transaction } from "kysely";
import { DB } from "../types/db";
import { CODE_DIVISORS, rebaseCode } from "./entity-codes.const";

/*
 * SOFT_DELETE_TASK.md §6.5: both cascades read and write the *_all base tables, not the same-named views that hide
 * deleted rows. A hidden descendant of a live parent must get the new code too, otherwise after a restore its code
 * would no longer contain the code of its teacher / school.
 */

/**
 * Recodes every student assigned to `teacherId` to embed `newTeacherCode`, inside `trx`.
 * Called both when a teacher's own code changes directly, and when it changes as a
 * consequence of its school's code changing (PHASE3_PLAN.md п.4 — 2-level cascade).
 * Logs each recoded student in code_change_logs with caused_by = this teacher.
 */
export async function cascadeTeacherCodeToStudents(
    trx: Transaction<DB>,
    teacherId: number,
    newTeacherCode: number,
    changedByUserId: number
): Promise<number> {
    const students = await trx.selectFrom("students_all").select(["id", "code"]).where("teacher_id", "=", teacherId).execute();

    for (const student of students) {
        const newCode = rebaseCode(student.code, newTeacherCode, CODE_DIVISORS.STUDENT_TO_TEACHER);
        if (newCode === student.code) continue;

        await trx.updateTable("students_all").set({ code: newCode }).where("id", "=", student.id).execute();
        await trx.insertInto("code_change_logs").values({
            entity_type: "student",
            entity_id: student.id,
            old_code: student.code,
            new_code: newCode,
            caused_by_entity_type: "teacher",
            caused_by_entity_id: teacherId,
            changed_by: changedByUserId,
        }).execute();
    }

    return students.length;
}

/**
 * Recodes every teacher at `schoolId` to embed `newSchoolCode`, then cascades each teacher's
 * new code down to its own students via cascadeTeacherCodeToStudents. Inside `trx`.
 */
export async function cascadeSchoolCodeToTeachers(
    trx: Transaction<DB>,
    schoolId: number,
    newSchoolCode: number,
    changedByUserId: number
): Promise<{ teachersCount: number; studentsCount: number }> {
    const teachers = await trx.selectFrom("teachers_all").select(["id", "code"]).where("school_id", "=", schoolId).execute();

    let studentsCount = 0;
    for (const teacher of teachers) {
        const newTeacherCode = rebaseCode(teacher.code, newSchoolCode, CODE_DIVISORS.TEACHER_TO_SCHOOL);

        if (newTeacherCode !== teacher.code) {
            await trx.updateTable("teachers_all").set({ code: newTeacherCode }).where("id", "=", teacher.id).execute();
            await trx.insertInto("code_change_logs").values({
                entity_type: "teacher",
                entity_id: teacher.id,
                old_code: teacher.code,
                new_code: newTeacherCode,
                caused_by_entity_type: "school",
                caused_by_entity_id: schoolId,
                changed_by: changedByUserId,
            }).execute();
        }

        studentsCount += await cascadeTeacherCodeToStudents(trx, teacher.id, newTeacherCode, changedByUserId);
    }

    return { teachersCount: teachers.length, studentsCount };
}
