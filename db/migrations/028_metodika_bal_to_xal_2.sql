-- 028_metodika_bal_to_xal_2.sql
-- Дата: 2026-09-20
-- Задача: продолжение 027. После её применения в сохранённом админом контенте страницы
-- «İSİM metodikası» (app_settings, ключ 'metodika.content') осталась фраза, которой в дефолте
-- фронта не было — заказчик писал её сам в редакторе, в двух карточках AYIN ŞAGİRDİ:
-- «… üzrə ən yüksək bal toplayan şagird(lər) …». Заказчик уточнил: слова «bal» на сайте
-- быть не должно вообще, везде «xal».
--
-- Тот же приём, что в 027: точечный replace по фразе, не regexp по подстроке «bal».

BEGIN;

UPDATE app_settings
SET value = replace(value::text, 'ən yüksək bal toplayan', 'ən yüksək xal toplayan')::jsonb,
    updated_at = now()
WHERE key = 'metodika.content'
  AND value::text LIKE '%ən yüksək bal toplayan%';

COMMIT;
