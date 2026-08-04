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
import { MongoClient } from "mongodb";
import { Client as PgClient } from "pg";

async function main() {
    const mongoClient = new MongoClient(process.env.MONGO_URL || "mongodb://mongo-etl-tmp:27017/kpm");
    await mongoClient.connect();
    const db = mongoClient.db();

    const pg = new PgClient({ connectionString: process.env.PG_URL });
    await pg.connect();

    try {
        const allStudents = await db.collection("students").find({}, { projection: { code: 1 } }).toArray();
        const counts = new Map<number, number>();
        for (const s of allStudents) counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
        const dupCodes = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c));

        const mongoOrdered = (
            await db.collection("students")
                .find({ lastName: { $exists: true, $ne: null, $ne: "" } }, { projection: { code: 1, lastName: 1, firstName: 1 } })
                .collation({ locale: "az", strength: 2 })
                .sort({ lastName: 1, firstName: 1, code: 1 })
                .toArray()
        ).filter((d) => !dupCodes.has(d.code));

        const pgRes = await pg.query(`
            SELECT code, last_name, first_name FROM students
            WHERE last_name IS NOT NULL AND last_name <> ''
            ORDER BY last_name COLLATE az_ci, first_name COLLATE az_ci, code
        `);
        const pgOrdered = pgRes.rows;

        console.log(`Mongo: ${mongoOrdered.length} записей, Postgres: ${pgOrdered.length} записей`);

        const mongoCodes = mongoOrdered.map((d) => d.code);
        const pgCodes = pgOrdered.map((d: any) => Number(d.code));
        const n = Math.min(mongoCodes.length, pgCodes.length);
        let firstDivergence = -1;
        for (let i = 0; i < n; i++) {
            if (mongoCodes[i] !== pgCodes[i]) { firstDivergence = i; break; }
        }

        if (firstDivergence === -1 && mongoCodes.length === pgCodes.length) {
            console.log("✅ Порядок полностью совпадает, побитово.");
        } else {
            const at = firstDivergence === -1 ? n : firstDivergence;
            console.log(`❌ Расхождение начиная с позиции ${at}:`);
            const from = Math.max(0, at - 3);
            for (let i = from; i < Math.min(from + 15, Math.max(mongoOrdered.length, pgOrdered.length)); i++) {
                const m: any = mongoOrdered[i], p: any = pgOrdered[i];
                console.log(`  [${i}] mongo: ${m ? `${m.lastName} ${m.firstName} (${m.code})` : "—"}   |   pg: ${p ? `${p.last_name} ${p.first_name} (${p.code})` : "—"}`);
            }
            process.exitCode = 1;
        }

        const specialChars = /[ƏəÇçŞşĞğİıÖöÜü]/;
        const mongoSpecial = mongoOrdered.filter((d) => specialChars.test(d.lastName || ""));
        console.log(`\nФамилий со спецсимволами (Ə/Ç/Ş/Ğ/İ/Ö/Ü): ${mongoSpecial.length}`);
        const pgIndexByCode = new Map(pgOrdered.map((d: any, i: number) => [Number(d.code), i]));
        const mongoIndexByCode = new Map(mongoCodes.map((c, i) => [c, i]));
        let specialOk = true;
        const specialCodes = mongoSpecial.map((d) => d.code);
        for (let i = 1; i < specialCodes.length; i++) {
            const mongoOrderOk = (mongoIndexByCode.get(specialCodes[i - 1]) ?? 0) < (mongoIndexByCode.get(specialCodes[i]) ?? 0);
            const pgOrderOk = (pgIndexByCode.get(specialCodes[i - 1]) ?? 0) < (pgIndexByCode.get(specialCodes[i]) ?? 0);
            if (mongoOrderOk !== pgOrderOk) {
                specialOk = false;
                console.log(`  расхождение относительного порядка: code=${specialCodes[i - 1]} vs code=${specialCodes[i]}`);
            }
        }
        console.log(specialOk ? "✅ Относительный порядок фамилий со спецсимволами совпадает." : "❌ Есть расхождения в относительном порядке спецсимвольных фамилий.");
        if (!specialOk) process.exitCode = 1;
    } finally {
        await pg.end();
        await mongoClient.close();
    }
}

main();
