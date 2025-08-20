"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseHandler = void 0;
class ResponseHandler {
    static success(data, message) {
        return {
            success: true,
            data,
            message
        };
    }
    static error(message, error) {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }
    static created(data, message = 'Resource created successfully') {
        return {
            success: true,
            data,
            message
        };
    }
    static updated(data, message = 'Resource updated successfully') {
        return {
            success: true,
            data,
            message
        };
    }
    static deleted(message = 'Resource deleted successfully') {
        return {
            success: true,
            message
        };
    }
    static notFound(message = 'Resource not found') {
        return {
            success: false,
            message
        };
    }
    static badRequest(message = 'Bad request', error) {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }
    static internalError(message = 'Internal server error', error) {
        return {
            success: false,
            message,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        };
    }
}
exports.ResponseHandler = ResponseHandler;
