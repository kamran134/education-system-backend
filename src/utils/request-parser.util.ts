import { Request } from "express";
import { PaginationOptions, FilterOptions, SortOptions } from "../types/common.types";
import { Types } from "mongoose";

export class RequestParser {
    static parsePagination(req: Request): PaginationOptions {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const size = Math.max(1, Math.min(1000, parseInt(req.query.size as string) || 100));
        const skip = (page - 1) * size;

        return { page, size, skip };
    }

    static parseSorting(req: Request, defaultColumn = 'createdAt', defaultDirection: 'asc' | 'desc' = 'desc'): SortOptions {
        const sortColumn = (req.query.sortColumn as string) || defaultColumn;
        const sortDirection = (req.query.sortDirection as 'asc' | 'desc') || defaultDirection;

        return { sortColumn, sortDirection };
    }

    static parseFilterOptions(req: Request): FilterOptions {
        const districtIds = req.query.districtIds && (req.query.districtIds as string).trim()
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id.trim()))
            : undefined;

        const schoolIds = req.query.schoolIds && (req.query.schoolIds as string).trim()
            ? (req.query.schoolIds as string).split(',').map(id => new Types.ObjectId(id.trim()))
            : undefined;

        const teacherIds = req.query.teacherIds && (req.query.teacherIds as string).trim()
            ? (req.query.teacherIds as string).split(',').map(id => new Types.ObjectId(id.trim()))
            : undefined;

        const examIds = req.query.examIds && (req.query.examIds as string).trim()
            ? (req.query.examIds as string).split(',').map(id => new Types.ObjectId(id.trim()))
            : undefined;

        const grades = req.query.grades && (req.query.grades as string).trim()
            ? (req.query.grades as string).split(',').map(grade => parseInt(grade, 10))
            : undefined;

        const code = req.query.code ? parseInt(req.query.code as string) : undefined;
        const month = req.query.month as string;
        const year = req.query.year as string;
        const search = req.query.search as string;
        const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;

        return {
            districtIds,
            schoolIds,
            teacherIds,
            examIds,
            grades,
            code,
            month,
            year,
            search,
            active
        };
    }

    static parseCodeRange(code: number, length: number): { start: string, end: string } {
        const codeString = code.toString().padEnd(length, '0');
        const codeStringEnd = code.toString().padEnd(length, '9');
        
        return { start: codeString, end: codeStringEnd };
    }

    static parseMonthRange(month: string): { startDate: Date, endDate: Date } {
        const [year, monthStr] = month.split("-");
        const monthIndex = parseInt(monthStr, 10) - 1;
        const selectedMonth = new Date(parseInt(year, 10), monthIndex, 1);
        const startDate = new Date(selectedMonth);
        const endDate = new Date(new Date(startDate).setMonth(startDate.getMonth() + 1));

        return { startDate, endDate };
    }
}
