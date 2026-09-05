import { pg } from "../config/pg";

/**
 * Контент публичной страницы «İSİM metodikası» — правки заказчика от 04.09.2026 (п.6 ТЗ):
 * в админке появляется редактор этой страницы. Хранится в общей таблице app_settings (миграция
 * 019, новая миграция не нужна), по образцу ratingYear.service.pg.ts.
 *
 * Отсутствие строки = страница показывает нынешний захардкоженный текст (дефолт живёт на
 * фронте, в metodika-content.model.ts) — бэкенд ничего не засеивает.
 *
 * Кэш в памяти сюда намеренно НЕ добавлен: страница читается редко (публичная, но не
 * лендинг), а несогласованность контента сразу после правки админом хуже экономии одного
 * запроса к БД. Не оптимизировать по аналогии с ratingYear.service.pg.ts.
 */

const SETTING_KEY = "metodika.content";

export async function getMetodikaContent(): Promise<unknown | null> {
    const row = await pg.selectFrom("app_settings").select("value").where("key", "=", SETTING_KEY).executeTakeFirst();
    return row ? row.value : null;
}

export async function setMetodikaContent(content: unknown, userId: number): Promise<void> {
    await pg
        .insertInto("app_settings")
        .values({ key: SETTING_KEY, value: JSON.stringify(content), updated_by: userId })
        .onConflict((oc) =>
            oc.column("key").doUpdateSet({ value: JSON.stringify(content), updated_by: userId, updated_at: new Date() })
        )
        .execute();
}

export async function resetMetodikaContent(): Promise<void> {
    await pg.deleteFrom("app_settings").where("key", "=", SETTING_KEY).execute();
}
