import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Required environment variable "${name}" is not defined. ` +
            `Check your .env file (see .env.example for reference).`
        );
    }
    return value;
}

export const JWT_SECRET = requireEnv("JWT_SECRET");
export const JWT_REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");
export const PG_URL = requireEnv("PG_URL");

// Публичный адрес фронтенда — используется для ссылки проверки сертификата в QR-коде.
// Не requireEnv: страница проверки не критична для запуска бэкенда, дефолт покрывает прод.
export const FRONTEND_URL = process.env.FRONTEND_URL || "https://isim.kpm.az";
