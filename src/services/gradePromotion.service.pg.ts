import { sql } from "kysely";
import { pg } from "../config/pg";
import { MAX_STUDENT_GRADE, isGradePromotionWindowOpen, getPromotionTargetAcademicYear, getCurrentAcademicYear } from "../utils/academic-year.util";
import { academicYearClosureServicePg } from "./academicYearClosure.service.pg";

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
    // Правильный порядок (ACADEMIC_YEAR_ARCHIVE_TASK.md §3.2): сначала закрыть уходящий
    // учебный год, потом повышать классы. false здесь — не запрет, а предупреждение в UI.
    currentYearClosed: boolean;
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

        const [alreadyPromoted, grouped, currentYearClosure] = await Promise.all([
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
            academicYearClosureServicePg.getClosure(getCurrentAcademicYear()),
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
            currentYearClosed: !!currentYearClosure,
        };
    }

    async execute(executedByUserId: number): Promise<GradePromotionResult> {
        if (!isGradePromotionWindowOpen()) {
            const err: any = new Error("Sinif yüksəltmə yalnız iyul-avqust aylarında mümkündür");
            err.status = 403;
            throw err;
        }

        const academicYear = getPromotionTargetAcademicYear();
        // Уходящий учебный год. Внутри окна июль-август это то же самое, что getCurrentAcademicYear()
        // (сентябрь ещё не наступил), но считаем от academicYear, чтобы не зависеть от границы окна,
        // если исполнение растянется по времени.
        const outgoingYear = academicYear - 1;

        // Вся операция — одна транзакция. Раньше это были отдельные запросы, а "битый" one-shot
        // замок подчищался DELETE-ом в catch; проблема в том, что падение ПОСЛЕ UPDATE students
        // снимало замок с уже повышенных учеников — повторный запуск повышал их второй раз.
        // Откат транзакции делает то же, что делал тот DELETE (строки лога не остаётся), но
        // заодно откатывает и сам UPDATE, и снимки истории классов.
        try {
            return await pg.transaction().execute(async (trx) => {
                // UNIQUE на academic_year — та же защита от повторного/параллельного запуска, что была
                // в Mongo (unique index → insert-race как lock), просто код нарушения другой (23505 vs 11000).
                const log = await trx
                    .insertInto("grade_promotion_logs")
                    .values({ academic_year: academicYear, status: "in_progress", executed_by: executedByUserId, executed_at: new Date() })
                    .returning("id")
                    .executeTakeFirstOrThrow();

                // Снимок уходящего года — ДО UPDATE, пока students.grade ещё старый. Два шага, по
                // тому же правилу, что и бэкфилл в 018_student_grade_history.sql: сначала живой
                // класс (самое свежее состояние реестра на конец года), поверх него — класс из
                // результатов, если они за тот год есть. Результаты сильнее: это класс, в котором
                // ученик реально сдавал, и именно по нему посчитано его место (v_student_places).
                // Оба шага DO UPDATE, а не DO NOTHING: строка за уходящий год уже может лежать с
                // бэкфилла миграции (там она — снимок живого grade на дату накатки) и не должна
                // пережить более свежие данные.
                // Выпускники (grade >= MAX_STUDENT_GRADE) участвуют наравне со всеми: их класс ниже
                // не изменится, но факт "в уходящем году был в 11-м" должен быть записан.
                await sql`
                    INSERT INTO student_grade_history (student_id, academic_year, grade)
                    SELECT id, ${outgoingYear}::int, grade FROM students WHERE grade IS NOT NULL
                    ON CONFLICT (student_id, academic_year) DO UPDATE SET grade = EXCLUDED.grade
                `.execute(trx);
                await sql`
                    INSERT INTO student_grade_history (student_id, academic_year, grade)
                    SELECT student_id, academic_year, grade FROM v_student_year_scores
                    WHERE academic_year = ${outgoingYear}::int
                    ON CONFLICT (student_id, academic_year) DO UPDATE SET grade = EXCLUDED.grade
                `.execute(trx);

                const promoteResult = await trx
                    .updateTable("students")
                    .set(({ eb }) => ({ grade: eb("grade", "+", 1) }))
                    .where("grade", "<", MAX_STUDENT_GRADE)
                    .executeTakeFirst();

                const ceilingRow = await trx
                    .selectFrom("students")
                    .select(({ fn }) => [fn.countAll().as("count")])
                    .where("grade", ">=", MAX_STUDENT_GRADE)
                    .executeTakeFirstOrThrow();

                const promotedCount = Number(promoteResult.numUpdatedRows);
                const ceilingCount = Number(ceilingRow.count);

                // Снимок нового года — ПОСЛЕ UPDATE, живой grade уже повышен. Шаг один: результатов
                // за ещё не начавшийся учебный год быть не может.
                await sql`
                    INSERT INTO student_grade_history (student_id, academic_year, grade)
                    SELECT id, ${academicYear}::int, grade FROM students WHERE grade IS NOT NULL
                    ON CONFLICT (student_id, academic_year) DO UPDATE SET grade = EXCLUDED.grade
                `.execute(trx);

                await trx
                    .updateTable("grade_promotion_logs")
                    .set({ status: "completed", promoted_count: promotedCount, ceiling_count: ceilingCount, completed_at: new Date() })
                    .where("id", "=", log.id)
                    .execute();

                return { academicYear, promotedCount, ceilingCount };
            });
        } catch (error: any) {
            if (error?.code === "23505") {
                const err: any = new Error(`${academicYear}/${academicYear + 1} tədris ili üçün siniflər artıq yüksəldilib`);
                err.status = 409;
                throw err;
            }
            throw error;
        }
    }
}

export const gradePromotionServicePg = new GradePromotionServicePg();
