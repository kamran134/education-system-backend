import { ApiResponse } from "../types/common.types";

export class ResponseHandler {
    static success<T>(data: T, message?: string): ApiResponse<T> {
        return {
            success: true,
            data,
            message
        };
    }

    static error(message: string, error?: unknown): ApiResponse {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }

    static created<T>(data: T, message = 'Resource created successfully'): ApiResponse<T> {
        return {
            success: true,
            data,
            message
        };
    }

    static updated<T>(data: T, message = 'Resource updated successfully'): ApiResponse<T> {
        return {
            success: true,
            data,
            message
        };
    }

    static deleted(message = 'Resource deleted successfully'): ApiResponse {
        return {
            success: true,
            message
        };
    }

    static notFound(message = 'Resource not found'): ApiResponse {
        return {
            success: false,
            message
        };
    }

    static badRequest(message = 'Bad request', error?: unknown): ApiResponse {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }

    static internalError(message = 'Internal server error', error?: unknown): ApiResponse {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }
}
