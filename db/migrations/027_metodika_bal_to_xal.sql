-- 027_metodika_bal_to_xal.sql
-- Дата: 2026-09-20
-- Задача: заказчик (Samir Vəliyev, WhatsApp 20.09.2026) просит на сайте и странице «İSİM
-- metodikası» писать «xal» вместо «bal» — речь о рейтинговых очках годового зачёта, а не об
-- экзаменационном балле. Дефолтные тексты страницы поправлены на фронте
-- (metodika-content.model.ts), но если админ уже сохранял страницу через редактор, её копия
-- лежит в app_settings под ключом 'metodika.content' и дефолт не читается — правим и её.
--
-- Замена точечная, по тем же четырём фразам, что в дефолте, а не regexp по подстроке «bal»:
-- слепая замена зацепила бы «qlobal», «bala» и т. п. Если админ переписал фразу своими словами
-- и она не совпала — строка остаётся как есть, поправить можно из редактора.
--
-- jsonb::text отдаёт не-ASCII символы как есть (без \uXXXX), поэтому replace по азербайджанским
-- буквам работает. Отсутствие строки = ничего не делаем (UPDATE по 0 строк).

BEGIN;

UPDATE app_settings
SET value = replace(replace(replace(replace(value::text,
        'topladığı balın faizinə', 'topladığı xalın faizinə'),
        'Kürsüdəki bal — ',        'Kürsüdəki xal — '),
        'iştirak balıdır',         'iştirak xalıdır'),
        'ən çox bal toplayan',     'ən çox xal toplayan')::jsonb,
    updated_at = now()
WHERE key = 'metodika.content'
  AND value::text <> replace(replace(replace(replace(value::text,
        'topladığı balın faizinə', 'topladığı xalın faizinə'),
        'Kürsüdəki bal — ',        'Kürsüdəki xal — '),
        'iştirak balıdır',         'iştirak xalıdır'),
        'ən çox bal toplayan',     'ən çox xal toplayan');

COMMIT;
