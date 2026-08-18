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

// Право на сертификат по каждому award_code — единственное место, где это решается.
// Для 'developing_student' зеркалит markDevelopingStudents() в stats.service.pg.ts:
// туда пишется status='İnkişaf edən şagird' + development_score=10 одновременно,
// достаточно проверить любое из двух (оба поля обнуляются вместе при пересчёте).
function isEligible(awardCode: string, sr: { status: string | null; development_score: number | null }): boolean {
    if (awardCode === "developing_student") {
        return sr.status === "İnkişaf edən şagird" || (sr.development_score ?? 0) > 0;
    }
    return false;
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

    // studentResultId ученика, доступных сертификатов может быть несколько наград —
    // для карточки ученика достаточно знать, какие award_code уже выданы/доступны.
    async availabilityForStudent(studentId: number): Promise<
        Record<number, { available: boolean; serial: string | null }>
    > {
        const results = await pg
            .selectFrom("student_results")
            .select(["id", "status", "development_score"])
            .where("student_id", "=", studentId)
            .execute();

        const issued = results.length
            ? await pg
                  .selectFrom("issued_certificates")
                  .select(["student_result_id", "serial", "revoked_at"])
                  .where(
                      "student_result_id",
                      "in",
                      results.map((r) => r.id)
                  )
                  .execute()
            : [];
        const issuedByResult = new Map(issued.map((i) => [i.student_result_id, i]));

        const out: Record<number, { available: boolean; serial: string | null }> = {};
        for (const r of results) {
            const already = issuedByResult.get(r.id);
            if (already && !already.revoked_at) {
                out[r.id] = { available: true, serial: already.serial };
                continue;
            }
            if (already?.revoked_at) {
                out[r.id] = { available: false, serial: null };
                continue;
            }
            out[r.id] = { available: isEligible("developing_student", r), serial: null };
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
            .select(["id", "status", "development_score"])
            .where("id", "=", studentResultId)
            .executeTakeFirst();
        if (!sr || !isEligible(awardCode, sr)) {
            throw new CertificateNotEligibleError("Bu nəticə üçün sertifikat mövcud deyil");
        }

        const { data, levelCode } = await this.buildData(studentResultId);

        const template = await templateService.findActive(awardCode, levelCode);
        if (!template) {
            throw new CertificateNoTemplateError(
                `Bu pillə üçün sertifikat şablonu hələ yüklənməyib (${awardCode}/${levelCode})`
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
