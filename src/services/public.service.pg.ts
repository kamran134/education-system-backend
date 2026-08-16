import { pg } from "../config/pg";

export interface PublicSummary {
    regions: number;
    districts: number;
    schools: number;
    teachers: number;
    students: number;
}

const TTL_MS = 60 * 60 * 1000; // час, см. LANDING_TASK.md §6.3

interface CacheState {
    data: PublicSummary | null;
    expiresAt: number;
}

// Модульная переменная, не MemoryCache: тому классу не хватает нужного здесь режима —
// отдать протухшее значение, если свежий подсчёт упал (см. getSummary ниже).
const cache: CacheState = { data: null, expiresAt: 0 };

export class PublicServicePg {
    async getSummary(): Promise<PublicSummary> {
        if (cache.data && Date.now() < cache.expiresAt) {
            return cache.data;
        }

        try {
            const fresh = await this.computeSummary();
            cache.data = fresh;
            cache.expiresAt = Date.now() + TTL_MS;
            return fresh;
        } catch (error) {
            // БД недоступна — отдаём то, что успели посчитать раньше (даже протухшее),
            // лишь бы не ронять публичный лендинг из-за временного сбоя подсчёта.
            if (cache.data) {
                console.error("[PublicServicePg] Свежий подсчёт summary упал, отдаю прошлое значение:", error);
                return cache.data;
            }
            // Ни свежих, ни старых данных нет (например, самый первый запрос после рестарта
            // упал) — честный 503, а не 500: это временная недоступность, не баг.
            (error as { status?: number }).status = 503;
            throw error;
        }
    }

    private async computeSummary(): Promise<PublicSummary> {
        const [regions, districts, schools, teachers, students] = await Promise.all([
            pg.selectFrom("regions").select(({ fn }) => [fn.countAll().as("count")]).where("active", "=", true).executeTakeFirstOrThrow(),
            pg.selectFrom("districts").select(({ fn }) => [fn.countAll().as("count")]).where("active", "=", true).executeTakeFirstOrThrow(),
            pg.selectFrom("schools").select(({ fn }) => [fn.countAll().as("count")]).where("active", "=", true).executeTakeFirstOrThrow(),
            pg.selectFrom("teachers").select(({ fn }) => [fn.countAll().as("count")]).where("active", "=", true).executeTakeFirstOrThrow(),
            // students не имеет колонки active (см. types/db.ts) — только текстовый status
            // с неясной семантикой (LANDING_TASK.md §6.2). Считаем всех, а не гадаем по status;
            // если понадобится фильтр — сверить значения status по проду сначала.
            pg.selectFrom("students").select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        return {
            regions: Number(regions.count),
            districts: Number(districts.count),
            schools: Number(schools.count),
            teachers: Number(teachers.count),
            students: Number(students.count),
        };
    }
}

export const publicServicePg = new PublicServicePg();
