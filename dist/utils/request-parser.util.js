"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestParser = void 0;
const mongoose_1 = require("mongoose");
class RequestParser {
    static parsePagination(req) {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const size = Math.max(1, Math.min(100, parseInt(req.query.size) || 10));
        const skip = (page - 1) * size;
        return { page, size, skip };
    }
    static parseSorting(req, defaultColumn = 'createdAt', defaultDirection = 'desc') {
        const sortColumn = req.query.sortColumn || defaultColumn;
        const sortDirection = req.query.sortDirection || defaultDirection;
        return { sortColumn, sortDirection };
    }
    static parseFilterOptions(req) {
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.Types.ObjectId(id.trim()))
            : undefined;
        const schoolIds = req.query.schoolIds
            ? req.query.schoolIds.split(',').map(id => new mongoose_1.Types.ObjectId(id.trim()))
            : undefined;
        const teacherIds = req.query.teacherIds
            ? req.query.teacherIds.split(',').map(id => new mongoose_1.Types.ObjectId(id.trim()))
            : undefined;
        const examIds = req.query.examIds
            ? req.query.examIds.split(',').map(id => new mongoose_1.Types.ObjectId(id.trim()))
            : undefined;
        const grades = req.query.grades
            ? req.query.grades.split(',').map(grade => parseInt(grade, 10))
            : undefined;
        const code = req.query.code ? parseInt(req.query.code) : undefined;
        const month = req.query.month;
        const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
        return {
            districtIds,
            schoolIds,
            teacherIds,
            examIds,
            grades,
            code,
            month,
            active
        };
    }
    static parseCodeRange(code, length) {
        const codeString = code.toString().padEnd(length, '0');
        const codeStringEnd = code.toString().padEnd(length, '9');
        return { start: codeString, end: codeStringEnd };
    }
    static parseMonthRange(month) {
        const [year, monthStr] = month.split("-");
        const monthIndex = parseInt(monthStr, 10) - 1;
        const selectedMonth = new Date(parseInt(year, 10), monthIndex, 1);
        const startDate = new Date(selectedMonth);
        const endDate = new Date(new Date(startDate).setMonth(startDate.getMonth() + 1));
        return { startDate, endDate };
    }
}
exports.RequestParser = RequestParser;
