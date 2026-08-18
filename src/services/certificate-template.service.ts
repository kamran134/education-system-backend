import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { pg } from "../config/pg";
import { CertificateField } from "../types/certificate.types";
import { defaultCertificateLayout } from "./certificate-default-layout";

export interface CertificateTemplate {
    id: number;
    awardCode: string;
    levelCode: string | null;
    name: string;
    imagePath: string;
    imageWidth: number;
    imageHeight: number;
    fields: CertificateField[];
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CERTIFICATES_DIR = path.join(process.cwd(), "uploads", "certificates");

function toTemplate(row: any): CertificateTemplate {
    return {
        id: row.id,
        awardCode: row.award_code,
        levelCode: row.level_code,
        name: row.name,
        imagePath: row.image_path,
        imageWidth: row.image_width,
        imageHeight: row.image_height,
        fields: row.fields ?? [],
        active: row.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class CertificateTemplateService {
    async list(): Promise<CertificateTemplate[]> {
        const rows = await pg
            .selectFrom("certificate_templates")
            .selectAll()
            .orderBy("award_code", "asc")
            .orderBy("level_code", "asc")
            .execute();
        return rows.map(toTemplate);
    }

    async findById(id: number): Promise<CertificateTemplate | null> {
        const row = await pg.selectFrom("certificate_templates").selectAll().where("id", "=", id).executeTakeFirst();
        return row ? toTemplate(row) : null;
    }

    // Активный шаблон под конкретную пиллю. levelCode передаётся как есть — для наград без
    // градации по пилле (award_code без уровня) вызывающий код передаёт null.
    async findActive(awardCode: string, levelCode: string | null): Promise<CertificateTemplate | null> {
        let query = pg
            .selectFrom("certificate_templates")
            .selectAll()
            .where("award_code", "=", awardCode)
            .where("active", "=", true);
        query = levelCode === null ? query.where("level_code", "is", null) : query.where("level_code", "=", levelCode);
        const row = await query.executeTakeFirst();
        return row ? toTemplate(row) : null;
    }

    /**
     * Пережимает картинку через sharp ДО сохранения — обязательный шаг, не оптимизация:
     * заказчик прислал шаблоны в CMYK (Photoshop-экспорт), а pdf-lib встраивает CMYK JPEG
     * через эвристическую инверсию Decode-массива (см. node_modules/pdf-lib JpegEmbedder) —
     * не гарантия правильных цветов для любого файла. .jpeg() без explicit toColorspace('cmyk')
     * сам приводит к sRGB, снимая этот риск полностью, вне зависимости от того, что прислал админ.
     * Имя файла — sha1 содержимого: уже выданные сертификаты ссылаются на конкретный файл
     * (issued_certificates.image_path), перезапись сломала бы воспроизводимость их PDF.
     */
    async saveImage(buffer: Buffer): Promise<{ imagePath: string; width: number; height: number }> {
        const normalized = await sharp(buffer)
            .resize({ width: 2480, withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer();

        const hash = crypto.createHash("sha1").update(normalized).digest("hex");
        const filename = `${hash}.jpg`;
        const fullPath = path.join(CERTIFICATES_DIR, filename);

        if (!fs.existsSync(CERTIFICATES_DIR)) {
            fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
        }
        if (!fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, normalized);
        }

        const meta = await sharp(normalized).metadata();
        return {
            // Ведущий слэш — как у avatarUrl (avatar.util.ts): фронт склеивает его с
            // getAssetBaseUrl() без разделителя (resolveAssetUrl), без слэша URL был бы битым.
            imagePath: `/uploads/certificates/${filename}`,
            width: meta.width!,
            height: meta.height!,
        };
    }

    async create(data: {
        awardCode: string;
        levelCode: string | null;
        name: string;
        imageBuffer: Buffer;
    }): Promise<CertificateTemplate> {
        const { imagePath, width, height } = await this.saveImage(data.imageBuffer);
        const row = await pg
            .insertInto("certificate_templates")
            .values({
                award_code: data.awardCode,
                level_code: data.levelCode,
                name: data.name,
                image_path: imagePath,
                image_width: width,
                image_height: height,
                // Не пустой массив: админ должен увидеть готовый сертификат сразу после
                // загрузки картинки и лишь подвинуть при необходимости.
                fields: JSON.stringify(defaultCertificateLayout()),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return toTemplate(row);
    }

    async updateFields(id: number, fields: CertificateField[], active?: boolean): Promise<CertificateTemplate | null> {
        const row = await pg
            .updateTable("certificate_templates")
            .set({
                fields: JSON.stringify(fields),
                ...(active !== undefined && { active }),
                updated_at: new Date(),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();
        return row ? toTemplate(row) : null;
    }

    async replaceImage(id: number, buffer: Buffer): Promise<CertificateTemplate | null> {
        const { imagePath, width, height } = await this.saveImage(buffer);
        const row = await pg
            .updateTable("certificate_templates")
            .set({ image_path: imagePath, image_width: width, image_height: height, updated_at: new Date() })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();
        return row ? toTemplate(row) : null;
    }

    async deactivate(id: number): Promise<boolean> {
        const row = await pg
            .updateTable("certificate_templates")
            .set({ active: false, updated_at: new Date() })
            .where("id", "=", id)
            .returning("id")
            .executeTakeFirst();
        return !!row;
    }
}
