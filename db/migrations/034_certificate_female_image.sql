-- 034_certificate_female_image.sql
-- Date: 2026-10-19
-- FIXES_14102026_TASK.md №7: an optional girl variant of a certificate template's background.
-- It shares the template's field layout, so it must have exactly the same pixel size as
-- image_path (enforced in certificate-template.service.ts, not here: the check needs the file).
-- Issuance picks it for students.gender = 'f' when it is set; issued_certificates.image_path
-- keeps snapshotting whichever image was used, so nothing changes there.
BEGIN;

ALTER TABLE certificate_templates ADD COLUMN female_image_path text;

COMMIT;
