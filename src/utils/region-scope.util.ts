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
