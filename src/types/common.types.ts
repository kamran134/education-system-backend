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
    role?: string;
}

export interface SortOptions {
    sortColumn: string;
    sortDirection: 'asc' | 'desc';
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    error?: unknown;
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
    skippedItems: unknown[];
    validationErrors?: {
        // For Teachers
        incorrectTeacherCodes?: number[];
        missingSchoolCodes?: number[];
        teacherCodesWithoutSchoolCodes?: number[];
        existingTeacherCodes?: number[];
        
        // For Schools
        incorrectSchoolCodes?: number[];
        missingDistrictCodes?: number[];
        schoolCodesWithoutDistrictCodes?: number[];
        existingSchoolCodes?: number[];
        
        // For Student Results
        incorrectStudentCodes?: number[];
        studentsWithoutTeacher?: number[];
        studentsWithIncorrectResults?: Array<{ code: number; reason: string }>;
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}
