"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const mongodb_1 = require("mongodb");
const pg_1 = require("pg");
function hex(id) {
    return id ? (id.toHexString ? id.toHexString() : String(id)) : null;
}
function approxEq(a, b, eps = 1e-6) {
    if (a == null && b == null)
        return true;
    if (a == null || b == null)
        return false;
    return Math.abs(a - b) <= eps;
}
// DENSE_RANK() возвращает bigint — node-pg отдаёт его строкой, сравнивать численно, не строго.
function placeEq(a, b) {
    if (a == null && b == null)
        return true;
    if (a == null || b == null)
        return false;
    return Number(a) === Number(b);
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const mongoClient = new mongodb_1.MongoClient(process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm");
        yield mongoClient.connect();
        const db = mongoClient.db();
        const pg = new pg_1.Client({ connectionString: process.env.PG_URL });
        yield pg.connect();
        let totalMismatches = 0;
        try {
            function compareLevel(table, viewScores, viewPlaces, fkColumn) {
                return __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    const docs = yield db.collection(table).find({}).toArray();
                    const scoresRes = yield pg.query(`SELECT * FROM ${viewScores}`);
                    const placesRes = yield pg.query(`SELECT * FROM ${viewPlaces}`);
                    const scoresByKey = new Map(scoresRes.rows.map((r) => [`${r[fkColumn]}:${r.academic_year}`, r]));
                    const placesByKey = new Map(placesRes.rows.map((r) => [`${r[fkColumn]}:${r.academic_year}`, r]));
                    const idRows = (yield pg.query(`SELECT id, code FROM ${table}`)).rows;
                    const pgIdByCode = new Map(idRows.map((r) => [Number(r.code), r.id]));
                    const reasons = new Map();
                    const bump = (reason) => { var _a; return reasons.set(reason, ((_a = reasons.get(reason)) !== null && _a !== void 0 ? _a : 0) + 1); };
                    let compared = 0, clean = 0;
                    for (const d of docs) {
                        const ratings = (_a = d.ratings) !== null && _a !== void 0 ? _a : [];
                        if (ratings.length === 0)
                            continue;
                        const latestYear = Math.max(...ratings.map((r) => r.year));
                        const latest = ratings.find((r) => r.year === latestYear);
                        const pgId = pgIdByCode.get(d.code);
                        if (pgId === undefined)
                            continue; // не перенесён — уже посчитано в других шагах (дубли кодов и т.п.)
                        compared++;
                        const key = `${pgId}:${latestYear}`;
                        const scoreRow = scoresByKey.get(key);
                        const placeRow = placesByKey.get(key);
                        let entityOk = true;
                        if (!scoreRow) {
                            bump("нет строки в view (сущность без текущих данных, но с устаревшим ratings[])");
                            entityOk = false;
                        }
                        else {
                            if (!approxEq(scoreRow.score, (_b = latest.score) !== null && _b !== void 0 ? _b : 0)) {
                                bump("score не совпал");
                                entityOk = false;
                            }
                            if (!approxEq(scoreRow.average_score, (_c = latest.averageScore) !== null && _c !== void 0 ? _c : 0)) {
                                bump("averageScore не совпал");
                                entityOk = false;
                            }
                        }
                        if (!placeRow && scoreRow) {
                            bump("нет места в view при наличии score-строки");
                            entityOk = false;
                        }
                        else if (placeRow) {
                            if (!placeEq(placeRow.place, latest.place)) {
                                bump("place не совпал");
                                entityOk = false;
                            }
                            if ("districtPlace" in latest && !placeEq(placeRow.district_place, latest.districtPlace)) {
                                bump("districtPlace не совпал");
                                entityOk = false;
                            }
                        }
                        if (entityOk)
                            clean++;
                    }
                    console.log(`\n--- ${table}: сравнено ${compared}, полностью совпало ${clean} ---`);
                    for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
                        console.log(`  ${count}\t${reason}`);
                        totalMismatches += count;
                    }
                });
            }
            yield compareLevel("students", "v_student_year_scores", "v_student_places", "student_id");
            yield compareLevel("teachers", "v_teacher_year_scores", "v_teacher_places", "teacher_id");
            yield compareLevel("schools", "v_school_year_scores", "v_school_places", "school_id");
            yield compareLevel("districts", "v_district_year_scores", "v_district_places", "district_id");
            console.log(`\nВсего расхождений (сумма по всем причинам, одна запись может дать несколько): ${totalMismatches}`);
            console.log("Каждое расхождение требует разбора по причине — см. db/rating-semantics.md. Ожидаемые категории:");
            console.log("  - «нет строки в view»: сущность без текущих данных, устаревшее место в Mongo (баг легаси-системы, не миграции)");
            console.log("  - score/averageScore/place/districtPlace: как правило каскад от известных исключённых дублей Student.code");
        }
        finally {
            yield pg.end();
            yield mongoClient.close();
        }
    });
}
main();
