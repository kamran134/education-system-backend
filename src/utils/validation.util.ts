import { ValidationResult } from "../types/common.types";

export class ValidationUtils {
    static validateRequired(value: any, fieldName: string): string | null {
        if (value === undefined || value === null || value === '') {
            return `${fieldName} is required`;
        }
        return null;
    }

    static validateEmail(email: string): string | null {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return 'Invalid email format';
        }
        return null;
    }

    static validateCode(code: number, minLength: number, maxLength: number): string | null {
        const codeStr = code.toString();
        if (codeStr.length < minLength || codeStr.length > maxLength) {
            return `Code must be between ${minLength} and ${maxLength} digits`;
        }
        return null;
    }

    static validateObjectId(id: string, fieldName: string): string | null {
        const objectIdRegex = /^[0-9a-fA-F]{24}$/;
        if (!objectIdRegex.test(id)) {
            return `${fieldName} must be a valid ObjectId`;
        }
        return null;
    }

    static validateNumber(value: any, fieldName: string, min?: number, max?: number): string | null {
        const num = Number(value);
        if (isNaN(num)) {
            return `${fieldName} must be a valid number`;
        }
        if (min !== undefined && num < min) {
            return `${fieldName} must be at least ${min}`;
        }
        if (max !== undefined && num > max) {
            return `${fieldName} must be at most ${max}`;
        }
        return null;
    }

    static validateArray(value: any, fieldName: string, minLength = 0): ValidationResult {
        const errors: string[] = [];
        
        if (!Array.isArray(value)) {
            errors.push(`${fieldName} must be an array`);
        } else if (value.length < minLength) {
            errors.push(`${fieldName} must have at least ${minLength} items`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static combine(validations: Array<string | null>): ValidationResult {
        const errors = validations.filter(v => v !== null) as string[];
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
