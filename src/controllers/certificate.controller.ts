import { Request, Response, NextFunction } from "express";
import { CertificateTemplateService } from "../services/certificate-template.service";
import { defaultCertificateLayout } from "../services/certificate-default-layout";
import { CertificateIssueService } from "../services/certificate-issue.service";
import { ResponseHandler } from "../utils/response-handler.util";
import { CertificateField } from "../types/certificate.types";

const templates = new CertificateTemplateService();
const issue = new CertificateIssueService();

export class CertificateController {
    // ---- Админ: шаблоны ----

    listTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            res.json(ResponseHandler.success(await templates.list()));
        } catch (err) {
            next(err);
        }
    };

    // Раскладка «по умолчанию» — для кнопки «Standart yerləşdirmə» в редакторе.
    getDefaultLayout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            res.json(ResponseHandler.success(defaultCertificateLayout()));
        } catch (err) {
            next(err);
        }
    };

    getTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const template = await templates.findById(parseInt(req.params.id, 10));
            if (!template) {
                res.status(404).json(ResponseHandler.notFound("Şablon tapılmadı"));
                return;
            }
            res.json(ResponseHandler.success(template));
        } catch (err) {
            next(err);
        }
    };

    createTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest("Şəkil yüklənməyib"));
                return;
            }
            const { awardCode, levelCode, name } = req.body;
            if (!awardCode || !name) {
                res.status(400).json(ResponseHandler.badRequest("awardCode və name tələb olunur"));
                return;
            }
            const template = await templates.create({
                awardCode,
                levelCode: levelCode || null,
                name,
                imageBuffer: req.file.buffer,
            });
            res.status(201).json(ResponseHandler.created(template));
        } catch (err: any) {
            // certificate_templates_award_level_uq — уже есть шаблон под эту награду/пиллю
            if (err?.code === "23505") {
                res.status(409).json(ResponseHandler.badRequest("Bu pillə üçün şablon artıq mövcuddur"));
                return;
            }
            next(err);
        }
    };

    updateTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = parseInt(req.params.id, 10);
            const fields: CertificateField[] = req.body.fields ?? [];
            const active: boolean | undefined = req.body.active;
            const updated = await templates.updateFields(id, fields, active);
            if (!updated) {
                res.status(404).json(ResponseHandler.notFound("Şablon tapılmadı"));
                return;
            }
            res.json(ResponseHandler.updated(updated));
        } catch (err) {
            next(err);
        }
    };

    replaceTemplateImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest("Şəkil yüklənməyib"));
                return;
            }
            const updated = await templates.replaceImage(parseInt(req.params.id, 10), req.file.buffer);
            if (!updated) {
                res.status(404).json(ResponseHandler.notFound("Şablon tapılmadı"));
                return;
            }
            res.json(ResponseHandler.updated(updated));
        } catch (err) {
            next(err);
        }
    };

    deleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const ok = await templates.deactivate(parseInt(req.params.id, 10));
            if (!ok) {
                res.status(404).json(ResponseHandler.notFound("Şablon tapılmadı"));
                return;
            }
            res.json(ResponseHandler.deleted());
        } catch (err) {
            next(err);
        }
    };

    // Не сохранённая раскладка — предпросмотр в конструкторе до нажатия "Yadda saxla".
    previewTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const templateId = parseInt(req.params.id, 10);
            const fields: CertificateField[] = req.body.fields ?? [];
            const studentResultId: number | undefined = req.body.studentResultId
                ? parseInt(req.body.studentResultId, 10)
                : undefined;

            const pdf = await issue.renderPreview(templateId, fields, studentResultId);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", 'inline; filename="onizleme.pdf"');
            res.send(pdf);
        } catch (err) {
            next(err);
        }
    };

    // ---- Админ: выданные сертификаты ----

    listIssued = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const size = Math.max(1, Math.min(200, parseInt(req.query.size as string) || 50));
            const { rows, total } = await issue.list({ limit: size, offset: (page - 1) * size });
            res.json(ResponseHandler.success({ rows, total, page, size }));
        } catch (err) {
            next(err);
        }
    };

    revokeIssued = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const ok = await issue.revoke(parseInt(req.params.id, 10), req.body.reason || "");
            if (!ok) {
                res.status(404).json(ResponseHandler.notFound("Sertifikat tapılmadı və ya artıq ləğv edilib"));
                return;
            }
            res.json(ResponseHandler.updated({ revoked: true }));
        } catch (err) {
            next(err);
        }
    };

    // ---- Скачивание (доступ = доступ к странице ученика, authMiddleware([])) ----

    downloadForResult = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const studentResultId = parseInt(req.params.studentResultId, 10);
            const issued = await issue.issueOrGet(studentResultId, "developing_student");
            const pdf = await issue.renderPdf(issued);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="sertifikat-${issued.serial}.pdf"`);
            res.send(pdf);
        } catch (err) {
            next(err);
        }
    };

    availabilityForStudent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const studentId = parseInt(req.params.studentId, 10);
            res.json(ResponseHandler.success(await issue.availabilityForStudent(studentId)));
        } catch (err) {
            next(err);
        }
    };

    // ---- Публичная проверка ----

    verifyByToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const issued = await issue.findByToken(req.params.token);
            if (!issued) {
                res.json(ResponseHandler.success({ valid: false }));
                return;
            }
            res.json(
                ResponseHandler.success({
                    valid: !issued.revokedAt,
                    serial: issued.serial,
                    issuedAt: issued.issuedAt,
                    revokedAt: issued.revokedAt,
                    data: issued.data,
                })
            );
        } catch (err) {
            next(err);
        }
    };
}
