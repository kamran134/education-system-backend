import { sql, RawBuilder } from "kysely";

/**
 * Which metric the "Filtr üzrə yer" (filterPlace) column ranks by. It follows the column the table
 * is sorted by (RATING_PLACES_TASK.md decision 2): sorted by the average score -> rank by the
 * average score, anything else -> rank by the raw score.
 */
export type RankBasis = "score" | "averageScore";

/**
 * Whitelist mapping of the request's sortColumn to a rank basis. sortColumn is user input and is
 * NEVER interpolated into SQL: it only selects one of the two column references the caller passes in.
 */
export function resolveRankBasis(sortColumn: string | undefined): RankBasis {
    return sortColumn === "averageScore" ? "averageScore" : "score";
}

/**
 * SQL expression of the rank metric for a list query. `columns` are trusted, hard-coded column
 * references of that entity (e.g. { score: "tyr.score", averageScore: "tyr.average_score" }).
 * Entities that have no average at all (monthly slices) pass `averageScore: undefined` and always
 * rank by the raw score.
 */
export function rankMetric(
    sortColumn: string | undefined,
    columns: { score: string; averageScore?: string }
): { basis: RankBasis; expr: RawBuilder<number> } {
    const wanted = resolveRankBasis(sortColumn);
    const basis: RankBasis = wanted === "averageScore" && columns.averageScore ? "averageScore" : "score";
    const column = basis === "averageScore" ? columns.averageScore! : columns.score;
    return { basis, expr: sql<number>`COALESCE(${sql.ref(column)}, 0)` };
}

/** DENSE_RANK() over the chosen metric, optionally within partitions (e.g. the student's grade). */
export function denseRankByMetric(metric: RawBuilder<number>, partitionBy?: RawBuilder<unknown>): RawBuilder<number> {
    return partitionBy
        ? sql<number>`DENSE_RANK() OVER (PARTITION BY ${partitionBy} ORDER BY ${metric} DESC)`
        : sql<number>`DENSE_RANK() OVER (ORDER BY ${metric} DESC)`;
}
