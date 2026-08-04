import { pg } from "../config/pg";
import { MAX_STUDENT_GRADE, isGradePromotionWindowOpen, getPromotionTargetAcademicYear } from "../utils/academic-year.util";

export interface GradeBucket {
    grade: number | null;
    count: number;
    targetGrade: number | null; // null = выпускной класс (или битая запись без grade) — не трогаем
}

export interface GradePromotionPreview {
    windowOpen: boolean;
    alreadyPromotedThisYear: boolean;
    targetAcademicYear: number;
    byGrade: GradeBucket[];
    promotableCount: number;
    ceilingCount: number;
}

export interface GradePromotionResult {
    academicYear: number;
    promotedCount: number;
    ceilingCount: number;
}

/**
 * Postgres-версия GradePromotionService — см. gradePromotion.service.ts (Mongo) для сравнения.
 * `executedByUserId` теперь число (users.id, FK), не строка ObjectId.
 */
export class GradePromotionServicePg {
    async preview(): Promise<GradePromotionPreview> {
        const targetAcademicYear = getPromotionTargetAcademicYear();

        const [alreadyPromoted, grouped] = await Promise.all([
            pg
                .selectFrom("grade_promotion_logs")
                .select("id")
                .where("academic_year", "=", targetAcademicYear)
                .where("status", "=", "completed")
                .executeTakeFirst(),
            pg
                .selectFrom("students")
                .select(["grade", ({ fn }) => fn.countAll().as("count")])
                .groupBy("grade")
                .orderBy("grade")
                .execute(),
        ]);

        const byGrade: GradeBucket[] = grouped.map((g) => {
            const grade = g.grade ?? null;
            const isCeiling = grade === null || grade >= MAX_STUDENT_GRADE;
            return {
                grade,
                count: Number(g.count),
                targetGrade: isCeiling ? null : (grade as number) + 1,
            };
        });

        const promotableCount = byGrade.filter((g) => g.targetGrade !== null).reduce((sum, g) => sum + g.count, 0);
        const ceilingCount = byGrade.filter((g) => g.targetGrade === null).reduce((sum, g) => sum + g.count, 0);

        return {
            windowOpen: isGradePromotionWindowOpen(),
            alreadyPromotedThisYear: !!alreadyPromoted,
            targetAcademicYear,
            byGrade,
            promotableCount,
            ceilingCount,
        };
    }

    async execute(executedByUserId: number): Promise<GradePromotionResult> {
        if (!isGradePromotionWindowOpen()) {
            const err: any = new Error("Sinif yüksəltmə yalnız iyul-avqust aylarında mümkündür");
            err.status = 403;
            throw err;
        }

        const academicYear = getPromotionTargetAcademicYear();

        // UNIQUE на academic_year — та же защита от повторного/параллельного запуска, что была
        // в Mongo (unique index → insert-race как lock), просто код нарушения другой (23505 vs 11000).
        let logId: number;
        try {
            const log = await pg
                .insertInto("grade_promotion_logs")
                .values({ academic_year: academicYear, status: "in_progress", executed_by: executedByUserId, executed_at: new Date() })
                .returning("id")
                .executeTakeFirstOrThrow();
            logId = log.id;
        } catch (error: any) {
            if (error?.code === "23505") {
                const err: any = new Error(`${academicYear}/${academicYear + 1} tədris ili üçün siniflər artıq yüksəldilib`);
                err.status = 409;
                throw err;
            }
            throw error;
        }

        try {
            const promoteResult = await pg
                .updateTable("students")
                .set(({ eb }) => ({ grade: eb("grade", "+", 1) }))
                .where("grade", "<", MAX_STUDENT_GRADE)
                .executeTakeFirst();

            const ceilingRow = await pg
                .selectFrom("students")
                .select(({ fn }) => [fn.countAll().as("count")])
                .where("grade", ">=", MAX_STUDENT_GRADE)
                .executeTakeFirstOrThrow();

            const promotedCount = Number(promoteResult.numUpdatedRows);
            const ceilingCount = Number(ceilingRow.count);

            await pg
                .updateTable("grade_promotion_logs")
                .set({ status: "completed", promoted_count: promotedCount, ceiling_count: ceilingCount, completed_at: new Date() })
                .where("id", "=", logId)
                .execute();

            return { academicYear, promotedCount, ceilingCount };
        } catch (error) {
            // Не оставляем "битый" one-shot замок висеть навсегда — тот же принцип, что в Mongo-версии.
            await pg.deleteFrom("grade_promotion_logs").where("id", "=", logId).execute();
            throw error;
        }
    }
}

export const gradePromotionServicePg = new GradePromotionServicePg();
