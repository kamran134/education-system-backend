import { pg } from "../config/pg";

/**
 * regionRepresenter в JWT несёт только regionId — но контроллеры скоупят данные по
 * districtIds (студенты/учителя/школы/районы фильтруются по району, не по региону).
 * Разворачиваем regionId в список district_id региона на каждый запрос — 41 строка
 * в таблице districts, кэшировать незачем (REGIONS_TASKS.md шаг 6).
 */
export async function districtIdsOfRegion(regionId: number): Promise<number[]> {
    const rows = await pg.selectFrom("districts").select("id").where("region_id", "=", regionId).execute();
    return rows.map((r) => r.id);
}

/**
 * Role scoping must NARROW the caller's own filter, not replace it. Replacing it silently
 * dropped the user's choice: a regionRepresenter who picked one district (Sumqayıt) got the
 * whole region back (Sumqayıt + Xırdalan + ...), see FIXES_14102026_TASK.md §1.
 *
 * - nothing requested          → the whole scope;
 * - requested ∩ scope non-empty → just that intersection;
 * - nothing of it in scope, or an empty scope → [-1]: an id that never exists, so the query
 *   returns nothing. Never [] — services read an empty array as "no filter".
 */
export function narrowToScope(requested: number[] | undefined, scope: number[]): number[] {
    if (scope.length === 0) return [-1];
    if (!requested || requested.length === 0) return scope;
    const allowed = new Set(scope);
    const kept = requested.filter((id) => allowed.has(id));
    return kept.length > 0 ? kept : [-1];
}
