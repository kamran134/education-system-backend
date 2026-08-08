import { sql } from "kysely";
import { pg } from "../config/pg";
import { getCurrentAcademicYear } from "../utils/academic-year.util";
import {
    StatisticsFilterPg,
    YearlyStatistics,
    MonthlyStatistics,
    StatisticsResponse,
    StatusStatistics,
    LevelStatistics,
    InkishafStatistics,
    InkishafFilterPg,
} from "../types/statistics.types";

/**
 * Postgres-версия StatisticsService (см. statistics.service.ts для сравнения — Mongo-версия
 * не удалена, но с 08.08.2026 не вызывается ни из одного роута, statistics.controller.ts
 * переключён на этот класс). Раздел `/api/statistics` был последним живым потребителем
 * MongoDB в бэкенде — после этого переноса connectDB() в index.ts убран (REGIONS_TASKS.md §6 п.1).
 *
 * Семантика воспроизведена дословно, включая один намеренно НЕ исправленный нюанс:
 * в getMonthlyStatistics() уровни (levelStatistics) считаются по каждому РЕЗУЛЬТАТУ, а не по
 * уникальному студенту — так было в Mongo-версии (results.forEach без Set), это отличается от
 * studentsOfMonth/developingStudents, которые считаются по уникальным студентам. Не унификация,
 * а точное повторение существующего (пусть и странного) поведения.
 */
export class StatisticsServicePg {
    private getAcademicYearDates(year: number): { startDate: Date; endDate: Date } {
        const startDate = new Date(year, 8, 1); // 1 сентября
        const endDate = new Date(year + 1, 5, 30, 23, 59, 59); // 30 июня
        return { startDate, endDate };
    }

    /** Окно дат для экзаменов: весь учебный год, либо конкретный календарный месяц внутри него. */
    private resolveExamWindow(filters: StatisticsFilterPg, academicYear: number): { start: Date; end: Date; endInclusive: boolean } {
        const { startDate, endDate } = this.getAcademicYearDates(academicYear);
        if (!filters.month) {
            return { start: startDate, end: endDate, endInclusive: false };
        }
        const monthNumber = typeof filters.month === "string" ? parseInt(filters.month) : filters.month;
        const calendarYear = monthNumber >= 9 ? academicYear : academicYear + 1;
        const monthStart = new Date(calendarYear, monthNumber - 1, 1);
        const monthEnd = new Date(calendarYear, monthNumber, 0, 23, 59, 59);
        return { start: monthStart, end: monthEnd, endInclusive: true };
    }

    /** Общий фильтр по региону/району/школе/учителю/классу — применяется к алиасу students-таблицы. */
    private applyStudentFilters<Q extends { where: any }>(query: Q, alias: string, filters: StatisticsFilterPg): Q {
        let q = query;
        if (filters.regionIds && filters.regionIds.length > 0) {
            q = q.where(`${alias}.region_id` as any, "in", filters.regionIds);
        }
        if (filters.districtIds && filters.districtIds.length > 0) {
            q = q.where(`${alias}.district_id` as any, "in", filters.districtIds);
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            q = q.where(`${alias}.school_id` as any, "in", filters.schoolIds);
        }
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            q = q.where(`${alias}.teacher_id` as any, "in", filters.teacherIds);
        }
        if (filters.grades && filters.grades.length > 0) {
            q = q.where(`${alias}.grade` as any, "in", filters.grades);
        }
        return q;
    }

    private calculatePercentage(count: number, total: number): number {
        return total > 0 ? Math.round((count / total) * 100 * 100) / 100 : 0;
    }

    private emptyLevelCounts(): Record<"E" | "D" | "C" | "B" | "A" | "Lisey", number> {
        return { E: 0, D: 0, C: 0, B: 0, A: 0, Lisey: 0 };
    }

    private levelCountsToStatistics(counts: Record<string, number>, total: number): LevelStatistics {
        const pct = (n: number) => this.calculatePercentage(n, total);
        return {
            E: { count: counts.E, percentage: pct(counts.E) },
            D: { count: counts.D, percentage: pct(counts.D) },
            C: { count: counts.C, percentage: pct(counts.C) },
            B: { count: counts.B, percentage: pct(counts.B) },
            A: { count: counts.A, percentage: pct(counts.A) },
            Lisey: { count: counts.Lisey, percentage: pct(counts.Lisey) },
        };
    }

    async getYearlyStatistics(filters: StatisticsFilterPg = {}): Promise<YearlyStatistics> {
        const academicYear = filters.year || getCurrentAcademicYear();
        const { start, end, endInclusive } = this.resolveExamWindow(filters, academicYear);

        // Регион у района, а не у студента напрямую — джойн districts нужен только для regionIds.
        let studentsBase = pg
            .selectFrom("students as st")
            .leftJoin("districts as d", "d.id", "st.district_id");
        studentsBase = this.applyStudentFilters(studentsBase as any, "st", filters) as any;
        if (filters.regionIds && filters.regionIds.length > 0) {
            studentsBase = (studentsBase as any).where("d.region_id", "in", filters.regionIds);
        }

        const [totalStudentsRow, levelRows, aggRow] = await Promise.all([
            studentsBase.select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
            studentsBase.select(["st.max_level as max_level", ({ fn }) => fn.countAll().as("count")]).groupBy("st.max_level").execute(),
            (() => {
                let q = pg
                    .selectFrom("student_results as sr")
                    .innerJoin("students as st", "st.id", "sr.student_id")
                    .leftJoin("exams as e", "e.id", "sr.exam_id")
                    .where("e.date", ">=", start)
                    .where("e.date", endInclusive ? "<=" : "<", end);
                q = this.applyStudentFilters(q as any, "st", filters) as any;
                if (filters.regionIds && filters.regionIds.length > 0) {
                    q = (q as any).innerJoin("districts as d2", "d2.id", "st.district_id").where("d2.region_id", "in", filters.regionIds);
                }
                return q
                    .select(({ fn }) => [
                        sql<number>`count(sr.id)`.as("score_count"),
                        sql<number>`coalesce(sum(sr.score), 0)`.as("total_score"),
                        sql<number>`count(distinct sr.student_id) filter (where sr.student_of_the_month_score > 0)`.as("students_of_month"),
                        sql<number>`count(distinct sr.student_id) filter (where sr.republic_wide_student_of_the_month_score > 0)`.as("republic_students_of_month"),
                        sql<number>`count(distinct sr.student_id) filter (where sr.development_score > 0)`.as("developing_students"),
                    ])
                    .executeTakeFirst();
            })(),
        ]);

        const totalStudents = Number(totalStudentsRow.count);
        const levelCounts = this.emptyLevelCounts();
        const levelKeyByRank: Record<number, keyof typeof levelCounts> = { 1: "E", 2: "D", 3: "C", 4: "B", 5: "A", 6: "Lisey" };
        for (const row of levelRows) {
            const key = row.max_level != null ? levelKeyByRank[row.max_level] : undefined;
            if (key) levelCounts[key] = Number(row.count);
        }

        const scoreCount = Number(aggRow?.score_count ?? 0);
        const totalScore = Number(aggRow?.total_score ?? 0);

        return {
            totalStudents,
            studentsOfMonth: {
                count: Number(aggRow?.students_of_month ?? 0),
                percentage: this.calculatePercentage(Number(aggRow?.students_of_month ?? 0), totalStudents),
            },
            republicStudentsOfMonth: {
                count: Number(aggRow?.republic_students_of_month ?? 0),
                percentage: this.calculatePercentage(Number(aggRow?.republic_students_of_month ?? 0), totalStudents),
            },
            developingStudents: {
                count: Number(aggRow?.developing_students ?? 0),
                percentage: this.calculatePercentage(Number(aggRow?.developing_students ?? 0), totalStudents),
            },
            averageScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 100) / 100 : 0,
            levelStatistics: this.levelCountsToStatistics(levelCounts, totalStudents),
        };
    }

    async getMonthlyStatistics(filters: StatisticsFilterPg = {}): Promise<MonthlyStatistics[]> {
        const academicYear = filters.year || getCurrentAcademicYear();
        const { start, end, endInclusive } = this.resolveExamWindow(filters, academicYear);

        let q = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .innerJoin("exams as e", "e.id", "sr.exam_id")
            .where("e.date", ">=", start)
            .where("e.date", endInclusive ? "<=" : "<", end);
        q = this.applyStudentFilters(q as any, "st", filters) as any;
        if (filters.regionIds && filters.regionIds.length > 0) {
            q = (q as any).innerJoin("districts as d", "d.id", "st.district_id").where("d.region_id", "in", filters.regionIds);
        }

        const rows = await q
            .select(({ fn }) => [
                sql<string>`to_char(e.date, 'YYYY-MM')`.as("month_key"),
                fn.countAll().as("total_results"),
                sql<number>`count(distinct sr.student_id)`.as("unique_students"),
                sql<number>`count(distinct sr.student_id) filter (where sr.student_of_the_month_score > 0)`.as("students_of_month"),
                sql<number>`count(distinct sr.student_id) filter (where sr.republic_wide_student_of_the_month_score > 0)`.as("republic_students_of_month"),
                sql<number>`count(distinct sr.student_id) filter (where sr.development_score > 0)`.as("developing_students"),
                // Уровни — по каждому результату, НЕ по уникальному студенту (см. class-докстринг).
                sql<number>`count(*) filter (where st.max_level = 1)`.as("level_e"),
                sql<number>`count(*) filter (where st.max_level = 2)`.as("level_d"),
                sql<number>`count(*) filter (where st.max_level = 3)`.as("level_c"),
                sql<number>`count(*) filter (where st.max_level = 4)`.as("level_b"),
                sql<number>`count(*) filter (where st.max_level = 5)`.as("level_a"),
                sql<number>`count(*) filter (where st.max_level = 6)`.as("level_lisey"),
            ])
            .groupBy(sql`to_char(e.date, 'YYYY-MM')`)
            .orderBy(sql`to_char(e.date, 'YYYY-MM')`)
            .execute();

        const monthNames = [
            "Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun",
            "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr",
        ];

        return rows.map((row) => {
            const uniqueStudentsCount = Number(row.unique_students);
            const levelCounts = {
                E: Number(row.level_e), D: Number(row.level_d), C: Number(row.level_c),
                B: Number(row.level_b), A: Number(row.level_a), Lisey: Number(row.level_lisey),
            };
            const monthIndex = parseInt(row.month_key.split("-")[1], 10) - 1;

            return {
                month: row.month_key,
                monthName: monthNames[monthIndex],
                totalResults: Number(row.total_results),
                studentsOfMonth: {
                    count: Number(row.students_of_month),
                    percentage: this.calculatePercentage(Number(row.students_of_month), uniqueStudentsCount),
                },
                republicStudentsOfMonth: {
                    count: Number(row.republic_students_of_month),
                    percentage: this.calculatePercentage(Number(row.republic_students_of_month), uniqueStudentsCount),
                },
                developingStudents: {
                    count: Number(row.developing_students),
                    percentage: this.calculatePercentage(Number(row.developing_students), uniqueStudentsCount),
                },
                levelStatistics: this.levelCountsToStatistics(levelCounts, uniqueStudentsCount),
            };
        });
    }

    async getStatistics(filters: StatisticsFilterPg = {}): Promise<StatisticsResponse> {
        const [yearly, monthly] = await Promise.all([
            this.getYearlyStatistics(filters),
            this.getMonthlyStatistics(filters),
        ]);
        return { yearly, monthly };
    }

    /** Не поддерживает filters.month — как и Mongo-версия, всегда считает за весь учебный год. */
    async getInkishafStatistics(filters: InkishafFilterPg = {}): Promise<InkishafStatistics> {
        const academicYear = filters.year || getCurrentAcademicYear();
        const { startDate, endDate } = this.getAcademicYearDates(academicYear);
        const minParticipations = filters.minParticipations && filters.minParticipations >= 2 ? filters.minParticipations : 2;

        let q = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .innerJoin("exams as e", "e.id", "sr.exam_id")
            .where("e.date", ">=", startDate)
            .where("e.date", "<", endDate);
        q = this.applyStudentFilters(q as any, "st", filters) as any;
        if (filters.regionIds && filters.regionIds.length > 0) {
            q = (q as any).innerJoin("districts as d", "d.id", "st.district_id").where("d.region_id", "in", filters.regionIds);
        }

        const participation = await q
            .groupBy("sr.student_id")
            .select(({ fn }) => [
                "sr.student_id as student_id",
                fn.countAll().as("participations"),
                sql<boolean>`bool_or(coalesce(sr.development_score, 0) > 0)`.as("has_development"),
            ])
            .execute();

        let maxParticipations = 0;
        let baseCount = 0;
        let developingCount = 0;
        for (const row of participation) {
            const count = Number(row.participations);
            if (count > maxParticipations) maxParticipations = count;
            if (count >= minParticipations) {
                baseCount++;
                if (row.has_development) developingCount++;
            }
        }

        return {
            minParticipations,
            maxParticipations: Math.max(maxParticipations, minParticipations),
            baseCount,
            developingCount,
            percentage: baseCount > 0 ? Math.round((developingCount / baseCount) * 100 * 100) / 100 : 0,
        };
    }
}

export const statisticsServicePg = new StatisticsServicePg();
