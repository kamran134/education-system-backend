import { Request, Response, NextFunction } from "express";
import { ExamResultsUseCase } from "../usecases/examResults.usecase";
import { ExamResultRow, ExamResultsFilterPg } from "../services/examResults.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { isAdminLike } from "../utils/avatar.util";
import { districtIdsOfRegion, narrowToScope } from "../utils/region-scope.util";
import { academicYearOfDate, getCurrentAcademicYear } from "../utils/academic-year.util";

export class ExamResultsController {
    private examResultsUseCase: ExamResultsUseCase;

    constructor() {
        this.examResultsUseCase = new ExamResultsUseCase();
    }

    getExamResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const sort = RequestParser.parseSorting(req, 'exam.date', 'desc');

            const params = {
                ...(await this.parseScopedFilters(req)),
                sortColumn: sort.sortColumn,
                sortDirection: sort.sortDirection as 'asc' | 'desc',
                page: pagination.page,
                size: pagination.size
            };

            const result = await this.examResultsUseCase.getExamResults(params);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    /**
     * DELETE /api/exam-results — the same query string as GET, deletes every matching result
     * (admin / superadmin only, see the route). Returns the number of deleted results.
     */
    deleteExamResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const deletedCount = await this.examResultsUseCase.deleteExamResults(await this.parseScopedFilters(req));
            res.json(ResponseHandler.success({ deletedCount }, `${deletedCount} nəticə silindi`));
        } catch (error: any) {
            if (error?.status) {
                res.status(error.status).json(ResponseHandler.error(error.message));
                return;
            }
            next(error);
        }
    }

    /** Filters from the query string, narrowed to the caller's scope. Shared by GET and DELETE. */
    private parseScopedFilters = async (req: Request): Promise<ExamResultsFilterPg> => {
        const params: ExamResultsFilterPg = {
            search: req.query.search as string,
            code: req.query.code ? parseInt(req.query.code as string) : undefined,
            dateFrom: req.query.dateFrom as string,
            dateTo: req.query.dateTo as string,
            examIds: req.query.examIds ? (req.query.examIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
            districtIds: req.query.districtIds ? (req.query.districtIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
            schoolIds: req.query.schoolIds ? (req.query.schoolIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
            teacherIds: req.query.teacherIds ? (req.query.teacherIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
            studentIds: undefined,
            grades: req.query.grades ? (req.query.grades as string).split(',').map(g => parseInt(g)) : undefined,
            examTypeId: req.query.examTypeId ? parseInt(req.query.examTypeId as string, 10) : undefined,
        };

        // Ролевое сужение — тот же приём, что в teacher.controller.ts:getTeachers. Перезаписывает
        // только «свой» ключ, остальные фильтры из query остаются как есть и применяются как AND:
        // это и есть защита от подстановки чужого id (пересечение со своей областью даст пустую выборку).
        if (req.user?.role === 'teacher' && req.user.teacherId) {
            params.teacherIds = narrowToScope(params.teacherIds, [parseInt(req.user.teacherId, 10)]);
        } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
            params.schoolIds = narrowToScope(params.schoolIds, [parseInt(req.user.schoolId, 10)]);
        } else if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
            params.districtIds = narrowToScope(params.districtIds, [parseInt(req.user.districtId, 10)]);
        } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
            params.districtIds = narrowToScope(params.districtIds, await districtIdsOfRegion(parseInt(req.user.regionId, 10)));
        } else if (req.user?.role === 'student' && req.user.studentId) {
            // Ученик видит только свои результаты. Без этой ветки роль проваливалась мимо
            // всех остальных и получала выборку по всей республике: у student нет ни
            // teacherId, ни schoolId, ни districtId в токене, только studentId.
            params.studentIds = [parseInt(req.user.studentId, 10)];
        }

        // Г3 B (customer decision): every role except admin/superadmin sees the current academic year only.
        // getCurrentAcademicYear(), not resolveRatingYear() — the latter stays on the old year until ratings are
        // activated; explicit role check, not isAdminLike — it includes moderator.
        if (this.isYearRestricted(req)) params.academicYear = getCurrentAcademicYear();

        return params;
    }

    /** Г3 B: roles limited to the current academic year (everyone but admin/superadmin, moderator included). */
    private isYearRestricted = (req: Request): boolean => {
        const role = req.user?.role;
        return !(role === 'admin' || role === 'superadmin');
    }

    /** GET /api/exam-results/latest-exam — latest exam with results inside the caller's scope (null if none). */
    getLatestExam = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = await this.parseScopedFilters(req);
            const examId = await this.examResultsUseCase.getLatestExamId(filters);
            res.json(ResponseHandler.success({ examId }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getExamResultById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const result = await this.examResultsUseCase.getExamResultById(id);

            if (!result) {
                res.status(404).json(ResponseHandler.notFound('Məlumat tapılmadı'));
                return;
            }

            if (!(await this.isVisibleToUser(req, result))) {
                // Тот же 404, что и для несуществующей записи — не подсказываем чужой роли,
                // что запись вообще существует (в отличие от 403).
                res.status(404).json(ResponseHandler.notFound('Məlumat tapılmadı'));
                return;
            }

            // Г3 B: past-year results are hidden from restricted roles here too (by-id bypasses the list filter).
            if (this.isYearRestricted(req)
                && (!result.exam || academicYearOfDate(new Date(result.exam.date)) !== getCurrentAcademicYear())) {
                res.status(404).json(ResponseHandler.notFound('Məlumat tapılmadı'));
                return;
            }

            res.json(ResponseHandler.success(result, 'Nəticə uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    /**
     * Проверка видимости одной записи по роли — то же сужение, что в getExamResults, только
     * не через фильтр запроса, а сверкой с уже полученным результатом (id уже известен).
     */
    private isVisibleToUser = async (req: Request, result: ExamResultRow): Promise<boolean> => {
        const role = req.user?.role;

        if (isAdminLike(role)) return true;

        if (role === 'teacher' && req.user?.teacherId) {
            return result.studentData.teacher?.id === parseInt(req.user.teacherId, 10);
        }

        if (role === 'schoolDirector' && req.user?.schoolId) {
            return result.studentData.school?.id === parseInt(req.user.schoolId, 10);
        }

        if (role === 'districtRepresenter' && req.user?.districtId) {
            return result.studentData.district?.id === parseInt(req.user.districtId, 10);
        }

        if (role === 'regionRepresenter' && req.user?.regionId) {
            const regionDistrictIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            return result.studentData.district?.id != null && regionDistrictIds.includes(result.studentData.district.id);
        }

        if (role === 'student' && req.user?.studentId) {
            return result.studentData.id === parseInt(req.user.studentId, 10);
        }

        return false;
    }
}

const examResultsController = new ExamResultsController();

export const getExamResults = examResultsController.getExamResults;
export const getExamResultById = examResultsController.getExamResultById;
export const getLatestExam = examResultsController.getLatestExam;
export const deleteExamResults = examResultsController.deleteExamResults;