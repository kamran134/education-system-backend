import { pg } from "../config/pg";
import { sql } from "kysely";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

const YEAR_RATING_TABLES = [
    "student_year_ratings",
    "teacher_year_ratings",
    "school_year_ratings",
    "district_year_ratings",
    "region_year_ratings",
] as const;

export interface ClosureChecksums {
    [table: string]: { count: number; sumScore: number };
}

export interface AcademicYearClosure {
    academicYear: number;
    closedAt: Date;
    closedBy: number | null;
    closedByEmail: string | null;
    closedReason: "manual" | "auto";
    note: string | null;
    checksums: ClosureChecksums;
}

/**
 * Заморозка учебных годов (ACADEMIC_YEAR_ARCHIVE_TASK.md §3). Закрытый год пересчитывать
 * нельзя: views в db/schema.sql считают по ЖИВЫМ связям (student→teacher→school→district) и
 * живым student_count — после повышения классов и перевода учеников пересчёт прошлого года
 * даёт другие цифры и другие места, восстановить неоткуда.
 */
export class AcademicYearClosureServicePg {
    async getClosure(year: number): Promise<AcademicYearClosure | null> {
        const row = await pg
            .selectFrom("academic_year_closures as c")
            .leftJoin("users as u", "u.id", "c.closed_by")
            .select([
                "c.academic_year as academic_year", "c.closed_at as closed_at", "c.closed_by as closed_by",
                "c.closed_reason as closed_reason", "c.note as note", "c.checksums as checksums",
                "u.email as closed_by_email",
            ])
            .where("c.academic_year", "=", year)
            .executeTakeFirst();
        if (!row) return null;
        return {
            academicYear: row.academic_year,
            closedAt: row.closed_at,
            closedBy: row.closed_by,
            closedByEmail: row.closed_by_email ?? null,
            closedReason: row.closed_reason as "manual" | "auto",
            note: row.note,
            checksums: (row.checksums as ClosureChecksums) ?? {},
        };
    }

    async assertYearNotClosed(year: number): Promise<void> {
        const closed = await this.getClosure(year);
        if (closed) {
            const err: any = new Error(
                `${year}/${year + 1} tədris ili bağlanıb — statistikanı yenidən hesablamaq olmaz`
            );
            err.status = 409;
            throw err;
        }
    }

    async computeChecksums(year: number): Promise<ClosureChecksums> {
        const result: ClosureChecksums = {};
        for (const table of YEAR_RATING_TABLES) {
            const row = await pg
                .selectFrom(table)
                .select(({ fn }) => [fn.countAll().as("count"), fn.sum("score").as("sum_score")])
                .where("year", "=", year)
                .executeTakeFirstOrThrow();
            result[table] = { count: Number(row.count), sumScore: Number(row.sum_score) || 0 };
        }
        return result;
    }

    /**
     * Ручное закрытие (кнопка в админке) — вызывающий код должен прогнать финальный
     * updateAllStats() ДО этого вызова. PRIMARY KEY на academic_year — защита от повторного/
     * параллельного закрытия, код 23505 → HTTP 409 (тот же приём, что в grade_promotion_logs).
     *
     * Инкремент стажа учителей (BASE_FIXES_TASK.md §2.3) — в ОДНОЙ транзакции со вставкой
     * закрытия: если вставка упадёт на 23505 (год уже закрыт кем-то параллельно), инкремент
     * должен откатиться вместе с ней, иначе повторный вызов накрутит лишний год всем учителям.
     */
    async closeManually(year: number, closedByUserId: number, note?: string): Promise<void> {
        const checksums = await this.computeChecksums(year);
        try {
            await pg.transaction().execute(async (trx) => {
                await trx
                    .insertInto("academic_year_closures")
                    .values({
                        academic_year: year,
                        closed_by: closedByUserId,
                        closed_reason: "manual",
                        note: note ?? null,
                        checksums: JSON.stringify(checksums),
                    })
                    .execute();

                await trx
                    .updateTable("teachers")
                    .set(({ eb }) => ({ pedagogical_experience_years: eb("pedagogical_experience_years", "+", 1) }))
                    .where("pedagogical_experience_years", "is not", null)
                    .execute();
            });
        } catch (error: any) {
            if (error?.code === "23505") {
                const err: any = new Error(`${year}/${year + 1} tədris ili artıq bağlanıb`);
                err.status = 409;
                throw err;
            }
            throw error;
        }
    }

    /**
     * Закрывает все учебные годы, у которых уже есть строки в *_year_ratings, они меньше
     * текущего учебного года и ещё не закрыты. ПЕРЕСЧЁТА ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО: к моменту
     * авто-закрытия (первое обращение к бэкенду после 1 сентября) классы уже повышены —
     * пересчёт сломал бы то, что мы замораживаем. Идемпотентно: гонка параллельных вызовов
     * разрешается через PRIMARY KEY (23505 просто игнорируется — кто-то успел раньше).
     */
    async ensureFinishedYearsClosed(): Promise<number[]> {
        const currentYear = getCurrentAcademicYear();
        const rows = await sql<{ year: number }>`
            SELECT DISTINCT year FROM (
                SELECT year FROM student_year_ratings
                UNION SELECT year FROM teacher_year_ratings
                UNION SELECT year FROM school_year_ratings
                UNION SELECT year FROM district_year_ratings
                UNION SELECT year FROM region_year_ratings
            ) all_years
            WHERE year < ${currentYear}
              AND year NOT IN (SELECT academic_year FROM academic_year_closures)
            ORDER BY year
        `.execute(pg);

        const closed: number[] = [];
        for (const { year } of rows.rows) {
            const checksums = await this.computeChecksums(year);
            try {
                // Каждый год — своя транзакция: гонка на ОДНОМ годе (23505, кто-то успел
                // раньше) не должна откатывать уже закрытые в этом же вызове предыдущие годы.
                // Инкремент стажа учителей — здесь же, чтобы 23505 откатывал и его тоже
                // (BASE_FIXES_TASK.md §2.3, тот же довод, что в closeManually).
                await pg.transaction().execute(async (trx) => {
                    await trx
                        .insertInto("academic_year_closures")
                        .values({
                            academic_year: year,
                            closed_by: null,
                            closed_reason: "auto",
                            note: null,
                            checksums: JSON.stringify(checksums),
                        })
                        .execute();

                    await trx
                        .updateTable("teachers")
                        .set(({ eb }) => ({ pedagogical_experience_years: eb("pedagogical_experience_years", "+", 1) }))
                        .where("pedagogical_experience_years", "is not", null)
                        .execute();
                });
                closed.push(year);
            } catch (error: any) {
                if (error?.code !== "23505") throw error;
            }
        }
        return closed;
    }
}

export const academicYearClosureServicePg = new AcademicYearClosureServicePg();
