/**
 * Шаг 6 PG_MIGRATION_TASKS.md: сверка views (путь A, db/rating-semantics.md)
 * против плоских/ratings[]-полей сущностей в Mongo — того, что реально
 * записал последний прогон StatsService в проде (путь A или путь B).
 *
 * Год сравнения для каждой сущности — максимальный year в её собственном
 * ratings[] (то есть именно та точка, которую отражают плоские поля),
 * а не текущий учебный год: так сравнение не зависит от того, когда
 * скрипт запускается относительно академического календаря.
 *
 * Расхождения печатаются с разбивкой по причине, а не построчно — этого
 * требует и объём (тысячи записей), и сама природа проверки: разные причины
 * расхождений (сущность без текущих данных vs каскад от известного гейта)
 * требуют разных выводов, смешивать их в одну кучу бессмысленно.
 *
 * Запуск: MONGO_URL=... PG_URL=... npx ts-node verify-rating-chain.ts
 */
import { MongoClient, ObjectId } from "mongodb";
import { Client as PgClient } from "pg";

function hex(id: ObjectId | null | undefined): string | null {
    return id ? (id.toHexString ? id.toHexString() : String(id)) : null;
}
function approxEq(a: number | null | undefined, b: number | null | undefined, eps = 1e-6): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(a - b) <= eps;
}
// DENSE_RANK() возвращает bigint — node-pg отдаёт его строкой, сравнивать численно, не строго.
function placeEq(a: unknown, b: unknown): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Number(a) === Number(b);
}

async function main() {
    const mongoClient = new MongoClient(process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm");
    await mongoClient.connect();
    const db = mongoClient.db();
    const pg = new PgClient({ connectionString: process.env.PG_URL });
    await pg.connect();

    let totalMismatches = 0;

    try {
        async function compareLevel(table: string, viewScores: string, viewPlaces: string, fkColumn: string) {
            const docs = await db.collection(table).find({}).toArray();
            const scoresRes = await pg.query(`SELECT * FROM ${viewScores}`);
            const placesRes = await pg.query(`SELECT * FROM ${viewPlaces}`);
            const scoresByKey = new Map(scoresRes.rows.map((r: any) => [`${r[fkColumn]}:${r.academic_year}`, r]));
            const placesByKey = new Map(placesRes.rows.map((r: any) => [`${r[fkColumn]}:${r.academic_year}`, r]));
            const idRows = (await pg.query(`SELECT id, code FROM ${table}`)).rows;
            const pgIdByCode = new Map(idRows.map((r: any) => [Number(r.code), r.id]));

            const reasons = new Map<string, number>();
            const bump = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

            let compared = 0, clean = 0;
            for (const d of docs as any[]) {
                const ratings = d.ratings ?? [];
                if (ratings.length === 0) continue;
                const latestYear = Math.max(...ratings.map((r: any) => r.year));
                const latest = ratings.find((r: any) => r.year === latestYear);
                const pgId = pgIdByCode.get(d.code);
                if (pgId === undefined) continue; // не перенесён — уже посчитано в других шагах (дубли кодов и т.п.)
                compared++;

                const key = `${pgId}:${latestYear}`;
                const scoreRow: any = scoresByKey.get(key);
                const placeRow: any = placesByKey.get(key);

                let entityOk = true;
                if (!scoreRow) { bump("нет строки в view (сущность без текущих данных, но с устаревшим ratings[])"); entityOk = false; }
                else {
                    if (!approxEq(scoreRow.score, latest.score ?? 0)) { bump("score не совпал"); entityOk = false; }
                    if (!approxEq(scoreRow.average_score, latest.averageScore ?? 0)) { bump("averageScore не совпал"); entityOk = false; }
                }
                if (!placeRow && scoreRow) { bump("нет места в view при наличии score-строки"); entityOk = false; }
                else if (placeRow) {
                    if (!placeEq(placeRow.place, latest.place)) { bump("place не совпал"); entityOk = false; }
                    if ("districtPlace" in latest && !placeEq(placeRow.district_place, latest.districtPlace)) { bump("districtPlace не совпал"); entityOk = false; }
                }
                if (entityOk) clean++;
            }
            console.log(`\n--- ${table}: сравнено ${compared}, полностью совпало ${clean} ---`);
            for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
                console.log(`  ${count}\t${reason}`);
                totalMismatches += count;
            }
        }

        await compareLevel("students", "v_student_year_scores", "v_student_places", "student_id");
        await compareLevel("teachers", "v_teacher_year_scores", "v_teacher_places", "teacher_id");
        await compareLevel("schools", "v_school_year_scores", "v_school_places", "school_id");
        await compareLevel("districts", "v_district_year_scores", "v_district_places", "district_id");

        console.log(`\nВсего расхождений (сумма по всем причинам, одна запись может дать несколько): ${totalMismatches}`);
        console.log("Каждое расхождение требует разбора по причине — см. db/rating-semantics.md. Ожидаемые категории:");
        console.log("  - «нет строки в view»: сущность без текущих данных, устаревшее место в Mongo (баг легаси-системы, не миграции)");
        console.log("  - score/averageScore/place/districtPlace: как правило каскад от известных исключённых дублей Student.code");
    } finally {
        await pg.end();
        await mongoClient.close();
    }
}

main();
