import { Request, Response, NextFunction } from "express";
import { ExamResultsUseCase } from "../usecases/examResults.usecase";
import { ExamResultRow } from "../services/examResults.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { isAdminLike } from "../utils/avatar.util";
import { districtIdsOfRegion } from "../utils/region-scope.util";

export class ExamResultsController {
    private examResultsUseCase: ExamResultsUseCase;

    constructor() {
        this.examResultsUseCase = new ExamResultsUseCase();
    }

    getExamResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const sort = RequestParser.parseSorting(req, 'exam.date', 'desc');

            // Parse filters
            const params = {
                search: req.query.search as string,
                code: req.query.code ? parseInt(req.query.code as string) : undefined,
                dateFrom: req.query.dateFrom as string,
                dateTo: req.query.dateTo as string,
                examIds: req.query.examIds ? (req.query.examIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
                districtIds: req.query.districtIds ? (req.query.districtIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
                schoolIds: req.query.schoolIds ? (req.query.schoolIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
                teacherIds: req.query.teacherIds ? (req.query.teacherIds as string).split(',').map(id => parseInt(id, 10)) : undefined,
                grades: req.query.grades ? (req.query.grades as string).split(',').map(g => parseInt(g)) : undefined,
                sortColumn: sort.sortColumn,
                sortDirection: sort.sortDirection as 'asc' | 'desc',
                page: pagination.page,
                size: pagination.size
            };

            // Ролевое сужение — тот же приём, что в teacher.controller.ts:getTeachers. Перезаписывает
            // только «свой» ключ, остальные фильтры из query остаются как есть и применяются как AND:
            // это и есть защита от подстановки чужого id (пересечение со своей областью даст пустую выборку).
            if (req.user?.role === 'teacher' && req.user.teacherId) {
                params.teacherIds = [parseInt(req.user.teacherId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                params.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                params.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                const regionDistrictIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
                params.districtIds = params.districtIds
                    ? params.districtIds.filter(id => regionDistrictIds.includes(id))
                    : regionDistrictIds;
            }

            const result = await this.examResultsUseCase.getExamResults(params);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
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

        return false;
    }
}

const examResultsController = new ExamResultsController();

export const getExamResults = examResultsController.getExamResults;
export const getExamResultById = examResultsController.getExamResultById;