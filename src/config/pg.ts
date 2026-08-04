import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import type { DB } from "../types/db";
import { PG_URL } from "./env";

// bigint (OID 20) -> JS number вместо строки. Безопасно: id — bigserial с начала диапазона,
// code — максимум 10 знаков (студенческий), оба далеко внутри Number.MAX_SAFE_INTEGER (2^53).
// Без этого каждый id/code в JSON-ответах API превращался бы в строку.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

export const pg = new Kysely<DB>({
    dialect: new PostgresDialect({
        pool: new Pool({ connectionString: PG_URL }),
    }),
});
