import { Request, Response } from "express";
import { StatsUseCase } from "../usecases/stats.usecase";
import { StatsServicePg } from "../services/stats.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { districtIdsOfRegion } from "../utils/region-scope.util";

export class StatsController {
    private statsUseCase: StatsUseCase;

    constructor() {
        const statsService = new StatsServicePg();
        this.statsUseCase = new StatsUseCase(statsService);
    }

    async updateStatistics(req: Request, res: Response): Promise<void> {
        try {
            await this.statsUseCase.updateStatistics();
            res.status(200).json(ResponseHandler.success({}, 'Statistika uğurla yeniləndi'));
        } catch (error: any) {
            console.error('updateStatistics funksiyasında xəta baş verdi:', error);
            if (error.message.includes('Nəticə tapılmadı')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Statistikaların yenilənməsində xəta baş verdi', error));
            }
        }
    }

    async updateAllStatistics(req: Request, res: Response): Promise<void> {
        try {
            await this.statsUseCase.updateAllStatistics();
            res.status(200).json(ResponseHandler.success({}, 'Tədris ili üçün bütün statistikalar uğurla yeniləndi'));
        } catch (error: any) {
            console.error('updateAllStatistics funksiyasında xəta baş verdi:', error);
            if (error.message.includes('Nəticə tapılmadı')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Bütün statistikaların yenilənməsində xəta baş verdi', error));
            }
        }
    }

    async getStudentsStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                month: req.query.month as string,
                sortColumn: req.query.sortColumn as string,
                sortDirection: req.query.sortDirection as string
            };

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
                delete filters.schoolIds;
                delete filters.districtIds;
            } else if (req.user?.role === 'student' && req.user.studentId) {
                filters.studentIds = [parseInt(req.user.studentId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const statistics = await this.statsUseCase.getStudentStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStudentsStatistics:', error);
            if (error.message.includes('Month is required') || error.message.includes('format')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else if (error.message.includes('No exams found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching student statistics', error));
            }
        }
    }

    async getDevelopingStudents(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                month: req.query.month as string,
                sortColumn: req.query.sortColumn as string,
                sortDirection: req.query.sortDirection as string
            };

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
                delete filters.schoolIds;
                delete filters.districtIds;
            } else if (req.user?.role === 'student' && req.user.studentId) {
                filters.studentIds = [parseInt(req.user.studentId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const students = await this.statsUseCase.getDevelopingStudents(filters);
            res.status(200).json(ResponseHandler.success(students));
        } catch (error: any) {
            console.error('Error in getDevelopingStudents:', error);
            if (error.message.includes('Month is required') || error.message.includes('format')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else if (error.message.includes('No exams found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching developing students', error));
            }
        }
    }

    async getStudentsOfMonth(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                month: req.query.month as string,
                sortColumn: req.query.sortColumn as string,
                sortDirection: req.query.sortDirection as string
            };

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
                delete filters.schoolIds;
                delete filters.districtIds;
            } else if (req.user?.role === 'student' && req.user.studentId) {
                filters.studentIds = [parseInt(req.user.studentId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const students = await this.statsUseCase.getStudentsOfMonth(filters);
            res.status(200).json(ResponseHandler.success(students));
        } catch (error: any) {
            console.error('Error in getStudentsOfMonth:', error);
            if (error.message.includes('Month is required') || error.message.includes('format')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else if (error.message.includes('No exams found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching students of month', error));
            }
        }
    }

    async getStudentsOfMonthByRepublic(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                month: req.query.month as string,
                sortColumn: req.query.sortColumn as string,
                sortDirection: req.query.sortDirection as string
            };

            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' && req.user.schoolId) {
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher' && req.user.teacherId) {
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
                delete filters.schoolIds;
                delete filters.districtIds;
            } else if (req.user?.role === 'student' && req.user.studentId) {
                filters.studentIds = [parseInt(req.user.studentId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const students = await this.statsUseCase.getStudentsOfMonthByRepublic(filters);
            res.status(200).json(ResponseHandler.success(students));
        } catch (error: any) {
            console.error('Error in getStudentsOfMonthByRepublic:', error);
            if (error.message.includes('Month is required') || error.message.includes('format')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else if (error.message.includes('No exams found')) {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching students of month by republic', error));
            }
        }
    }

    async getStatisticsByExam(req: Request, res: Response): Promise<void> {
        try {
            const { examId } = req.params;
            const statistics = await this.statsUseCase.getStatisticsByExam(examId);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getStatisticsByExam:', error);
            if (error.message.includes('valid id') || error.message.includes('required')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching exam statistics', error));
            }
        }
    }

    async getTeacherStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc',
                page: parseInt(req.query.page as string) || 1,
                size: parseInt(req.query.size as string) || 100
            };

            if (req.user?.role === 'districtRepresenter') {
                if (!req.user.districtId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector') {
                if (!req.user.schoolId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher') {
                if (!req.user.teacherId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.teacherIds = [parseInt(req.user.teacherId, 10)];
            } else if (req.user?.role === 'regionRepresenter') {
                if (!req.user.regionId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const statistics = await this.statsUseCase.getTeacherStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getTeacherStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching teacher statistics', error));
        }
    }

    async getSchoolStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc',
                page: parseInt(req.query.page as string) || 1,
                size: parseInt(req.query.size as string) || 100
            };

            if (req.user?.role === 'districtRepresenter') {
                if (!req.user.districtId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector') {
                if (!req.user.schoolId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.schoolIds = [parseInt(req.user.schoolId, 10)];
            } else if (req.user?.role === 'teacher') {
                res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return;
            } else if (req.user?.role === 'regionRepresenter') {
                if (!req.user.regionId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const statistics = await this.statsUseCase.getSchoolStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getSchoolStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching school statistics', error));
        }
    }

    async getDistrictStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc',
                page: parseInt(req.query.page as string) || 1,
                size: parseInt(req.query.size as string) || 100
            };

            if (req.user?.role === 'districtRepresenter') {
                if (!req.user.districtId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'schoolDirector' || req.user?.role === 'teacher') {
                res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return;
            } else if (req.user?.role === 'regionRepresenter') {
                if (!req.user.regionId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const statistics = await this.statsUseCase.getDistrictStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getDistrictStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching district statistics', error));
        }
    }

    /**
     * regionRepresenter видит только свой регион; districtRepresenter/schoolDirector/teacher/student
     * не имеют своего региона — пустой результат (ср. getDistrictStatistics для schoolDirector/teacher).
     */
    async getRegionStatistics(req: Request, res: Response): Promise<void> {
        try {
            const filters = {
                ...RequestParser.parseFilterOptionsPg(req),
                sortColumn: req.query.sortColumn as string || 'averageScore',
                sortDirection: req.query.sortDirection as string || 'desc',
                page: parseInt(req.query.page as string) || 1,
                size: parseInt(req.query.size as string) || 100
            };

            if (req.user?.role === 'regionRepresenter') {
                if (!req.user.regionId) { res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return; }
                filters.regionIds = [parseInt(req.user.regionId, 10)];
            } else if (req.user?.role === 'districtRepresenter' || req.user?.role === 'schoolDirector' || req.user?.role === 'teacher' || req.user?.role === 'student') {
                res.status(200).json(ResponseHandler.success({ data: [], totalCount: 0 })); return;
            }

            const statistics = await this.statsUseCase.getRegionStatistics(filters);
            res.status(200).json(ResponseHandler.success(statistics));
        } catch (error: any) {
            console.error('Error in getRegionStatistics:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching region statistics', error));
        }
    }

    // migrateRatings (Mongo flat-fields → ratings[] one-off housekeeping) не перенесён —
    // бессмысленен в Postgres, где такого расхождения структурно не существует.
}

// Create instance and export methods for backward compatibility
const statsController = new StatsController();

export const updateStatistics = (req: Request, res: Response) => statsController.updateStatistics(req, res);
export const updateAllStatistics = (req: Request, res: Response) => statsController.updateAllStatistics(req, res);
export const getStudentsStatistics = (req: Request, res: Response) => statsController.getStudentsStatistics(req, res);
export const getDevelopingStudents = (req: Request, res: Response) => statsController.getDevelopingStudents(req, res);
export const getStudentsOfMonth = (req: Request, res: Response) => statsController.getStudentsOfMonth(req, res);
export const getStudentsOfMonthByRepublic = (req: Request, res: Response) => statsController.getStudentsOfMonthByRepublic(req, res);
export const getStatisticsByExam = (req: Request, res: Response) => statsController.getStatisticsByExam(req, res);
export const getTeacherStatistics = (req: Request, res: Response) => statsController.getTeacherStatistics(req, res);
export const getSchoolStatistics = (req: Request, res: Response) => statsController.getSchoolStatistics(req, res);
export const getDistrictStatistics = (req: Request, res: Response) => statsController.getDistrictStatistics(req, res);
export const getRegionStatistics = (req: Request, res: Response) => statsController.getRegionStatistics(req, res);
