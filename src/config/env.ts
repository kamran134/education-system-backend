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
