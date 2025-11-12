import { Types } from "mongoose";

export interface PaginationOptions {
    page: number;
    size: number;
    skip: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    totalCount: number;
    page: number;
    size: number;
    totalPages: number;
}

export interface FilterOptions {
    districtIds?: Types.ObjectId[];
    schoolIds?: Types.ObjectId[];
    teacherIds?: Types.ObjectId[];
    grades?: number[];
    code?: number;
    examIds?: Types.ObjectId[];
    month?: string;
    year?: string;
    search?: string;
    active?: boolean;
    dateFrom?: string;
    dateTo?: string;
}

export interface SortOptions {
    sortColumn: string;
    sortDirection: 'asc' | 'desc';
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: any;
}

export interface BulkOperationResult {
    insertedCount: number;
    modifiedCount: number;
    deletedCount: number;
    errors: string[];
}

export interface FileProcessingResult<T> {
    processedData: T[];
    errors: string[];
    skippedItems: any[];
    validationErrors?: {
        invalidDistrictCodes?: number[];
        invalidSchoolCodes?: number[];
        invalidTeacherCodes?: number[];
        invalidStudentCodes?: number[];
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}
