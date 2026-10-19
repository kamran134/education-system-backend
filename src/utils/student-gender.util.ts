import { Kysely, Transaction, sql } from "kysely";
import { DB } from "../types/db";

export type Gender = 'm' | 'f';

/** Minimum number of existing students sharing a given name before its gender statistics are trusted. */
const MIN_NAME_SAMPLE = 3;
/** Share of the dominant gender among those students required to trust the statistics. */
const MIN_NAME_DOMINANCE = 0.9;

function words(fullname: string): string[] {
    return fullname.trim().split(/\s+/).filter(Boolean);
}

/** fullname = "Soyad Ad Ata adı". Given name = the 2nd word. */
export function givenNameOf(fullname: string): string | null {
    return words(fullname)[1] ?? null;
}

/**
 * Gender from the patronymic marker ("oğlu" / "qızı" as the last word), else from the surname
 * ending (-ova/-eva = female, -ov/-ev = male). null when neither is conclusive.
 */
export function genderBySurname(fullname: string): Gender | null {
    const parts = words(fullname).map((w) => w.toLocaleLowerCase('az'));
    if (parts.length === 0) return null;

    const last = parts[parts.length - 1];
    if (last === 'oğlu') return 'm';
    if (last === 'qızı') return 'f';

    const surname = parts[0];
    if (surname.endsWith('ova') || surname.endsWith('eva')) return 'f';
    if (surname.endsWith('ov') || surname.endsWith('ev')) return 'm';
    return null;
}

/**
 * Infers the gender of new students from an import file. One query collects gender statistics per
 * given name among existing students that already have a gender. Rule per full name:
 *  1. statistics for the given name with n = m + f >= 3 and one side >= 90% -> that gender;
 *  2. otherwise genderBySurname();
 *  3. otherwise null.
 * Names are matched exactly (the registry spells them consistently); the result is keyed by the
 * full name exactly as passed in.
 */
export async function inferGenders(
    db: Kysely<DB> | Transaction<DB>,
    fullnames: string[]
): Promise<Map<string, Gender | null>> {
    const result = new Map<string, Gender | null>();
    if (fullnames.length === 0) return result;

    const givenNames = [...new Set(fullnames.map(givenNameOf).filter((n): n is string => n !== null))];

    const stats = new Map<string, { m: number; f: number }>();
    if (givenNames.length > 0) {
        // '\\s' — a lone '\s' inside a tagged template is cooked to plain 's'.
        const nameExpr = sql`split_part(btrim(regexp_replace(fullname, '\\s+', ' ', 'g')), ' ', 2)`;
        const rows = await sql<{ name: string; m: string; f: string }>`
            SELECT ${nameExpr} AS name,
                   count(*) FILTER (WHERE gender = 'm') AS m,
                   count(*) FILTER (WHERE gender = 'f') AS f
            FROM students
            WHERE gender IS NOT NULL AND ${nameExpr} = ANY(${givenNames}::text[])
            GROUP BY 1
        `.execute(db);
        for (const r of rows.rows) stats.set(r.name, { m: Number(r.m), f: Number(r.f) });
    }

    for (const fullname of fullnames) {
        if (result.has(fullname)) continue;
        let gender: Gender | null = null;

        const given = givenNameOf(fullname);
        const stat = given !== null ? stats.get(given) : undefined;
        if (stat) {
            const n = stat.m + stat.f;
            if (n >= MIN_NAME_SAMPLE) {
                if (stat.m / n >= MIN_NAME_DOMINANCE) gender = 'm';
                else if (stat.f / n >= MIN_NAME_DOMINANCE) gender = 'f';
            }
        }

        result.set(fullname, gender ?? genderBySurname(fullname));
    }
    return result;
}
