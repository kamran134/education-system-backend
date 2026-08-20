import path from "path";
import crypto from "crypto";
import { sql } from "kysely";
import { pg } from "../config/pg";
import { FRONTEND_URL } from "../config/env";
import { CertificateData, CertificateField } from "../types/certificate.types";
import { renderCertificate } from "./certificate-render.service";
import { CertificateTemplateService } from "./certificate-template.service";

// .status читает errorHandler.ts (res.status(err.status || 500)) — контроллеру достаточно next(err).
export class CertificateNotEligibleError extends Error {
    status = 404;
}
export class CertificateNoTemplateError extends Error {
    status = 409;
}
export class CertificateRevokedError extends Error {
    status = 410;
    constructor(serial: string) {
        super(`Sertifikat ləğv edilib (${serial})`);
    }
}

export interface IssuedCertificate {
    id: number;
    serial: string;
    verifyToken: string;
    studentResultId: number;
    awardCode: string;
    templateId: number;
    imagePath: string;
    imageWidth: number;
    imageHeight: number;
    layout: CertificateField[];
    data: CertificateData;
    issuedAt: Date;
    revokedAt: Date | null;
    revokeReason: string | null;
}

function toIssued(row: any): IssuedCertificate {
    return {
        id: row.id,
        serial: row.serial,
        verifyToken: row.verify_token,
        studentResultId: row.student_result_id,
        awardCode: row.award_code,
        templateId: row.template_id,
        imagePath: row.image_path,
        imageWidth: row.image_width,
        imageHeight: row.image_height,
        layout: row.layout,
        data: row.data,
        issuedAt: row.issued_at,
        revokedAt: row.revoked_at,
        revokeReason: row.revoke_reason,
    };
}

// Три награды, зеркалит CERTIFICATES_V2_TASK.md §4.1. Экспортируется — контроллер
// валидирует :awardCode из URL по этому же списку, чтобы не плодить второй источник истины.
export const AWARD_CODES = [
    "developing_student",
    "student_of_the_month",
    "republic_wide_student_of_the_month",
] as const;
export type AwardCode = (typeof AWARD_CODES)[number];

// Только developing_student градуирован по пилле — у остальных двух один шаблон на
// награду (level_code=NULL). buildData() всегда возвращает ФАКТИЧЕСКУЮ пиллю ученика
// на этом результате (нужна для рендера самого сертификата и для {level}), но искать
// шаблон по ней для наград без градации нельзя — там всегда искать level_code=null.
const LEVEL_GRADED_AWARDS: ReadonlySet<AwardCode> = new Set(["developing_student"]);

interface EligibilityRow {
    status: string | null;
    development_score: number | null;
    student_of_the_month_score: number | null;
    republic_wide_student_of_the_month_score: number | null;
}

// Право на сертификат по каждому award_code — единственное место, где это решается.
// 'developing_student' зеркалит markDevelopingStudents() в stats.service.pg.ts: туда
// пишется status='İnkişaf edən şagird' + development_score=10 одновременно, достаточно
// проверить любое из двух (оба поля обнуляются вместе при пересчёте). Обе месячные награды
// зеркалят awardStudentOfTheMonth() — та же функция ставит *_score=5 только победителям
// на уровне Lisey; это подтверждённое заказчиком поведение, не баг, здесь не расширяем.
function isEligible(awardCode: string, sr: EligibilityRow): boolean {
    switch (awardCode) {
        case "developing_student":
            return sr.status === "İnkişaf edən şagird" || (sr.development_score ?? 0) > 0;
        case "student_of_the_month":
            return (sr.student_of_the_month_score ?? 0) > 0;
        case "republic_wide_student_of_the_month":
            return (sr.republic_wide_student_of_the_month_score ?? 0) > 0;
        default:
            return false;
    }
}

const templateService = new CertificateTemplateService();

export class CertificateIssueService {
    async findByResultAndAward(studentResultId: number, awardCode: string): Promise<IssuedCertificate | null> {
        const row = await pg
            .selectFrom("issued_certificates")
            .selectAll()
            .where("student_result_id", "=", studentResultId)
            .where("award_code", "=", awardCode)
            .executeTakeFirst();
        return row ? toIssued(row) : null;
    }

    async findByToken(token: string): Promise<IssuedCertificate | null> {
        const row = await pg
            .selectFrom("issued_certificates")
            .selectAll()
            .where("verify_token", "=", token)
            .executeTakeFirst();
        return row ? toIssued(row) : null;
    }

    // Одному результату может полагаться сразу несколько наград (взял республику →
    // почти наверняка взял и район; плюс мог одновременно подняться в пилле) — отдаём
    // все три статуса на результат, а не один флаг (CERTIFICATES_V2_TASK.md §4.1).
    async availabilityForStudent(
        studentId: number
    ): Promise<Record<number, Record<AwardCode, { available: boolean; serial: string | null }>>> {
        const results = await pg
            .selectFrom("student_results")
            .select([
                "id",
                "status",
                "development_score",
                "student_of_the_month_score",
                "republic_wide_student_of_the_month_score",
            ])
            .where("student_id", "=", studentId)
            .execute();

        const issued = results.length
            ? await pg
                  .selectFrom("issued_certificates")
                  .select(["student_result_id", "award_code", "serial", "revoked_at"])
                  .where(
                      "student_result_id",
                      "in",
                      results.map((r) => r.id)
                  )
                  .execute()
            : [];
        const issuedByResultAward = new Map(issued.map((i) => [`${i.student_result_id}:${i.award_code}`, i]));

        const out: Record<number, Record<AwardCode, { available: boolean; serial: string | null }>> = {};
        for (const r of results) {
            const perAward = {} as Record<AwardCode, { available: boolean; serial: string | null }>;
            for (const award of AWARD_CODES) {
                const already = issuedByResultAward.get(`${r.id}:${award}`);
                if (already && !already.revoked_at) {
                    perAward[award] = { available: true, serial: already.serial };
                } else if (already?.revoked_at) {
                    perAward[award] = { available: false, serial: null };
                } else {
                    perAward[award] = { available: isEligible(award, r), serial: null };
                }
            }
            out[r.id] = perAward;
        }
        return out;
    }

    private async buildData(studentResultId: number): Promise<{ data: CertificateData; levelCode: string }> {
        const row = await pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .innerJoin("schools as sc", "sc.id", "st.school_id")
            .innerJoin("teachers as t", "t.id", "st.teacher_id")
            .leftJoin("districts as d", "d.id", "st.district_id")
            .innerJoin("exams as e", "e.id", "sr.exam_id")
            .select([
                "sr.id as sr_id",
                "sr.grade as grade",
                "sr.month as month",
                "sr.year as year",
                "sr.level as level",
                "sr.academic_year as academic_year",
                "e.date as exam_date",
                "st.last_name as last_name",
                "st.first_name as first_name",
                "st.middle_name as middle_name",
                "sc.name as school_name",
                "d.name as district_name",
                "t.fullname as teacher_fullname",
            ])
            .where("sr.id", "=", studentResultId)
            .executeTakeFirst();

        if (!row) throw new Error(`student_results.id=${studentResultId} не найден`);

        // Предыдущая (максимальная) пилля за тот же учебный год до этого экзамена —
        // та же логика, что prior_max в markDevelopingStudents() (stats.service.pg.ts).
        const prevLevel = await sql<{ code: string | null }>`
            SELECT lvl.code
            FROM student_results sr2
            JOIN exams e2 ON e2.id = sr2.exam_id
            JOIN levels lvl ON lvl.code = sr2.level
            WHERE sr2.student_id = (SELECT student_id FROM student_results WHERE id = ${studentResultId})
              AND sr2.academic_year = ${row.academic_year}
              AND e2.date < ${row.exam_date}
            ORDER BY lvl.rank DESC
            LIMIT 1
        `.execute(pg);

        const studentFullName = [row.last_name, row.first_name, row.middle_name].filter(Boolean).join(" ");

        return {
            levelCode: row.level,
            data: {
                studentFullName,
                schoolName: row.school_name,
                districtName: row.district_name,
                grade: row.grade,
                month: row.month,
                year: row.year,
                examDate: new Date(row.exam_date).toISOString().slice(0, 10),
                level: row.level,
                previousLevel: prevLevel.rows[0]?.code ?? null,
                teacherFullName: row.teacher_fullname,
            },
        };
    }

    /** Идемпотентно: повторный вызов для того же (studentResultId, awardCode) возвращает уже выданный сертификат. */
    async issueOrGet(studentResultId: number, awardCode: string): Promise<IssuedCertificate> {
        const existing = await this.findByResultAndAward(studentResultId, awardCode);
        if (existing) {
            if (existing.revokedAt) throw new CertificateRevokedError(existing.serial);
            return existing;
        }

        const sr = await pg
            .selectFrom("student_results")
            .select([
                "id",
                "status",
                "development_score",
                "student_of_the_month_score",
                "republic_wide_student_of_the_month_score",
            ])
            .where("id", "=", studentResultId)
            .executeTakeFirst();
        if (!sr || !isEligible(awardCode, sr)) {
            throw new CertificateNotEligibleError("Bu nəticə üçün sertifikat mövcud deyil");
        }

        const { data, levelCode } = await this.buildData(studentResultId);

        const templateLevelCode = LEVEL_GRADED_AWARDS.has(awardCode as AwardCode) ? levelCode : null;
        const template = await templateService.findActive(awardCode, templateLevelCode);
        if (!template) {
            throw new CertificateNoTemplateError(
                `Bu pillə üçün sertifikat şablonu hələ yüklənməyib (${awardCode}/${templateLevelCode})`
            );
        }

        const serial = await this.nextSerial();
        const verifyToken = crypto.randomBytes(9).toString("base64url");

        try {
            const row = await pg
                .insertInto("issued_certificates")
                .values({
                    serial,
                    verify_token: verifyToken,
                    student_result_id: studentResultId,
                    award_code: awardCode,
                    template_id: template.id,
                    image_path: template.imagePath,
                    image_width: template.imageWidth,
                    image_height: template.imageHeight,
                    layout: JSON.stringify(template.fields),
                    data: JSON.stringify(data),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
            return toIssued(row);
        } catch (err: any) {
            // Гонка: два одновременных запроса на скачивание одного результата.
            // UNIQUE(student_result_id, award_code) — берём уже вставленную строку.
            if (err?.code === "23505") {
                const raced = await this.findByResultAndAward(studentResultId, awardCode);
                if (raced) return raced;
            }
            throw err;
        }
    }

    private async nextSerial(): Promise<string> {
        const year = new Date().getFullYear();
        const seq = await sql<{ nextval: string }>`SELECT nextval('certificate_serial_seq') as nextval`.execute(pg);
        const n = seq.rows[0].nextval;
        return `ISIM-${year}-${String(n).padStart(6, "0")}`;
    }

    async revoke(id: number, reason: string): Promise<boolean> {
        const row = await pg
            .updateTable("issued_certificates")
            .set({ revoked_at: new Date(), revoke_reason: reason })
            .where("id", "=", id)
            .where("revoked_at", "is", null)
            .returning("id")
            .executeTakeFirst();
        return !!row;
    }

    // Жёсткое удаление снапшота — не то же самое, что revoke(). revoke оставляет след
    // (публичная проверка отвечает "ləğv edilib"), а этот метод стирает строку целиком:
    // следующее скачивание того же результата+награды пройдёт issueOrGet() с нуля и
    // снимет свежий снапшот с ТЕКУЩЕГО шаблона — новый serial, новый verify_token, старый
    // QR (если он вообще был встроен) станет невалиден. Ручная операция для конкретной
    // ситуации "шаблон был неправильным, хотим, чтобы все получили пересчитанный".
    async deleteSnapshot(id: number): Promise<boolean> {
        const row = await pg.deleteFrom("issued_certificates").where("id", "=", id).returning("id").executeTakeFirst();
        return !!row;
    }

    /**
     * Массовый сброс всех снапшотов конкретного шаблона. template_id — стабильный FK:
     * редактирование шаблона (updateFields/replaceImage) правит ТУ ЖЕ строку, не создаёт
     * новую, поэтому фильтр по template_id ловит все снапшоты, когда-либо снятые с этого
     * шаблона, независимо от того, какую версию раскладки/картинки они застали.
     */
    async deleteSnapshotsByTemplate(templateId: number): Promise<number> {
        const rows = await pg
            .deleteFrom("issued_certificates")
            .where("template_id", "=", templateId)
            .returning("id")
            .execute();
        return rows.length;
    }

    async list(opts: { limit: number; offset: number }): Promise<{ rows: IssuedCertificate[]; total: number }> {
        const rows = await pg
            .selectFrom("issued_certificates")
            .selectAll()
            .orderBy("issued_at", "desc")
            .limit(opts.limit)
            .offset(opts.offset)
            .execute();
        const totalRow = await pg
            .selectFrom("issued_certificates")
            .select(sql<number>`count(*)`.as("count"))
            .executeTakeFirstOrThrow();
        return { rows: rows.map(toIssued), total: Number(totalRow.count) };
    }

    verifyUrlFor(token: string): string {
        return `${FRONTEND_URL}/sertifikat/${token}`;
    }

    async renderPdf(issued: IssuedCertificate): Promise<Buffer> {
        return renderCertificate({
            imagePath: path.join(process.cwd(), issued.imagePath),
            imageWidth: issued.imageWidth,
            imageHeight: issued.imageHeight,
            layout: issued.layout,
            data: issued.data,
            serial: issued.serial,
            verifyUrl: this.verifyUrlFor(issued.verifyToken),
        });
    }

    /** Превью в конструкторе — не сохраняется, использует переданную (возможно, ещё не сохранённую) раскладку. */
    async renderPreview(templateId: number, fields: CertificateField[], studentResultId?: number): Promise<Buffer> {
        const template = await templateService.findById(templateId);
        if (!template) throw new Error(`certificate_templates.id=${templateId} не найден`);

        const data = studentResultId
            ? (await this.buildData(studentResultId)).data
            : SAMPLE_DATA;

        return renderCertificate({
            imagePath: path.join(process.cwd(), template.imagePath),
            imageWidth: template.imageWidth,
            imageHeight: template.imageHeight,
            layout: fields,
            data,
            serial: "ISIM-0000-000000",
            verifyUrl: `${FRONTEND_URL}/sertifikat/preview`,
        });
    }
}

// Данные примера заказчика — превью без привязки к живому ученику (§7 плана, POST .../preview без studentResultId).
const SAMPLE_DATA: CertificateData = {
    studentFullName: "Ələkbərov Rüstəm Rauf oğlu",
    schoolName: "Sumqayıt şəhər 5 nömrəli məktəb",
    districtName: "Sumqayıt şəhəri",
    grade: 2,
    month: 5,
    year: 2026,
    examDate: "2026-05-30",
    level: "A",
    previousLevel: "B",
    teacherFullName: "Hacıyeva Sevinc Sahib qızı",
};
