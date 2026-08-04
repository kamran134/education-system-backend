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
 * Шаг 5 PG_MIGRATION_TASKS.md: эмпирическая проверка азербайджанской сортировки.
 * Сравнивает порядок фамилий учеников: Mongo .collation({locale:'az',strength:2})
 * против Postgres ORDER BY ... COLLATE az_ci.
 *
 * code обязателен как тай-брейкер третьим ключом сортировки: без него настоящие
 * ничьи (одинаковые lastName+firstName у разных детей — таких в базе много)
 * дают ложные "расхождения", потому что порядок внутри ничьей не определён
 * ни в Mongo, ни в Postgres без дополнительного ключа.
 *
 * Дубли Student.code (известное исключение ETL) не участвуют — их нет в Postgres.
 *
 * Запуск: MONGO_URL=... PG_URL=... npx ts-node verify-az-collation.ts
 */
const mongodb_1 = require("mongodb");
const pg_1 = require("pg");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const mongoClient = new mongodb_1.MongoClient(process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm");
        yield mongoClient.connect();
        const db = mongoClient.db();
        const pg = new pg_1.Client({ connectionString: process.env.PG_URL });
        yield pg.connect();
        try {
            const allStudents = yield db.collection("students").find({}, { projection: { code: 1 } }).toArray();
            const counts = new Map();
            for (const s of allStudents)
                counts.set(s.code, ((_a = counts.get(s.code)) !== null && _a !== void 0 ? _a : 0) + 1);
            const dupCodes = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c));
            const mongoOrdered = (yield db.collection("students")
                .find({ lastName: { $exists: true, $ne: null, $ne: "" } }, { projection: { code: 1, lastName: 1, firstName: 1 } })
                .collation({ locale: "az", strength: 2 })
                .sort({ lastName: 1, firstName: 1, code: 1 })
                .toArray()).filter((d) => !dupCodes.has(d.code));
            const pgRes = yield pg.query(`
            SELECT code, last_name, first_name FROM students
            WHERE last_name IS NOT NULL AND last_name <> ''
            ORDER BY last_name COLLATE az_ci, first_name COLLATE az_ci, code
        `);
            const pgOrdered = pgRes.rows;
            console.log(`Mongo: ${mongoOrdered.length} записей, Postgres: ${pgOrdered.length} записей`);
            const mongoCodes = mongoOrdered.map((d) => d.code);
            const pgCodes = pgOrdered.map((d) => Number(d.code));
            const n = Math.min(mongoCodes.length, pgCodes.length);
            let firstDivergence = -1;
            for (let i = 0; i < n; i++) {
                if (mongoCodes[i] !== pgCodes[i]) {
                    firstDivergence = i;
                    break;
                }
            }
            if (firstDivergence === -1 && mongoCodes.length === pgCodes.length) {
                console.log("✅ Порядок полностью совпадает, побитово.");
            }
            else {
                const at = firstDivergence === -1 ? n : firstDivergence;
                console.log(`❌ Расхождение начиная с позиции ${at}:`);
                const from = Math.max(0, at - 3);
                for (let i = from; i < Math.min(from + 15, Math.max(mongoOrdered.length, pgOrdered.length)); i++) {
                    const m = mongoOrdered[i], p = pgOrdered[i];
                    console.log(`  [${i}] mongo: ${m ? `${m.lastName} ${m.firstName} (${m.code})` : "—"}   |   pg: ${p ? `${p.last_name} ${p.first_name} (${p.code})` : "—"}`);
                }
                process.exitCode = 1;
            }
            const specialChars = /[ƏəÇçŞşĞğİıÖöÜü]/;
            const mongoSpecial = mongoOrdered.filter((d) => specialChars.test(d.lastName || ""));
            console.log(`\nФамилий со спецсимволами (Ə/Ç/Ş/Ğ/İ/Ö/Ü): ${mongoSpecial.length}`);
            const pgIndexByCode = new Map(pgOrdered.map((d, i) => [Number(d.code), i]));
            const mongoIndexByCode = new Map(mongoCodes.map((c, i) => [c, i]));
            let specialOk = true;
            const specialCodes = mongoSpecial.map((d) => d.code);
            for (let i = 1; i < specialCodes.length; i++) {
                const mongoOrderOk = ((_b = mongoIndexByCode.get(specialCodes[i - 1])) !== null && _b !== void 0 ? _b : 0) < ((_c = mongoIndexByCode.get(specialCodes[i])) !== null && _c !== void 0 ? _c : 0);
                const pgOrderOk = ((_d = pgIndexByCode.get(specialCodes[i - 1])) !== null && _d !== void 0 ? _d : 0) < ((_e = pgIndexByCode.get(specialCodes[i])) !== null && _e !== void 0 ? _e : 0);
                if (mongoOrderOk !== pgOrderOk) {
                    specialOk = false;
                    console.log(`  расхождение относительного порядка: code=${specialCodes[i - 1]} vs code=${specialCodes[i]}`);
                }
            }
            console.log(specialOk ? "✅ Относительный порядок фамилий со спецсимволами совпадает." : "❌ Есть расхождения в относительном порядке спецсимвольных фамилий.");
            if (!specialOk)
                process.exitCode = 1;
        }
        finally {
            yield pg.end();
            yield mongoClient.close();
        }
    });
}
main();
