import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { DistrictUseCase } from "../usecases/district.usecase";
import { DistrictServicePg } from "../services/district.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { saveEntityAvatarPg, removeEntityAvatarPg, canManageOwnEntity } from "../utils/avatar.util";
import { districtIdsOfRegion } from "../utils/region-scope.util";

export class DistrictController {
    private districtUseCase: DistrictUseCase;

    constructor() {
        this.districtUseCase = new DistrictUseCase(new DistrictServicePg());
    }

    updateDistrictsStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.districtUseCase.updateDistrictsStats();
            res.json(ResponseHandler.success({}, 'Statistika uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    getDistricts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            // Role-based filtering: сохранено 1:1 из Mongo-версии, включая то, что buildFilter
            // districtIds не читает (см. комментарий в district.service.pg.ts) — не менять молча.
            if (req.user?.role === 'districtRepresenter' && req.user.districtId) {
                filters.districtIds = [parseInt(req.user.districtId, 10)];
            } else if (req.user?.role === 'regionRepresenter' && req.user.regionId) {
                filters.districtIds = await districtIdsOfRegion(parseInt(req.user.regionId, 10));
            }

            const result = await this.districtUseCase.getFilteredDistricts(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getDistrictsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptionsPg(req);
            const districts = await this.districtUseCase.getDistrictsForFilter(filters);

            res.json(ResponseHandler.success(districts, 'Filtr üçün məlumatlar uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getDistrictById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const district = await this.districtUseCase.getDistrictById(id);

            res.json(ResponseHandler.success(district, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const districtData = req.body;
            const district = await this.districtUseCase.createDistrict(districtData);

            res.status(201).json(ResponseHandler.created(district, 'Məlumat uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const district = await this.districtUseCase.updateDistrict(id, updateData);

            res.json(ResponseHandler.updated(district, 'Məlumat uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    /**
     * Самостоятельное редактирование ПРОФИЛЯ района (educationHeadName, PROFILES_TASK.md §2.3) —
     * не полный updateDistrict. Доступно admin/superadmin ИЛИ владельцу (districtRepresenter
     * своего района), в отличие от полного PUT /:id (только admin/superadmin/moderator, см.
     * routes). Тот же паттерн, что SchoolController.updateProfile / TeacherController.updateProfile.
     */
    updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.districtId, id)) {
                res.status(403).json(ResponseHandler.error('Yalnız öz rayonunuzun profilini redaktə edə bilərsiniz'));
                return;
            }

            const { educationHeadName } = req.body;
            const district = await this.districtUseCase.updateDistrictProfile(id, { educationHeadName });

            res.json(ResponseHandler.updated(district, 'Profil uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteDistrict = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.districtUseCase.deleteDistrict(id);

            res.json(ResponseHandler.deleted('Məlumat uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    deleteDistricts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.districtUseCase.deleteDistricts(ids);

            res.json(ResponseHandler.success(result, ` məlumat uğurla silindi`));
        } catch (error) {
            next(error);
        }
    }

    processDistrictsFromExcel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const result = await this.districtUseCase.processDistrictsFromExcel(req.file.path);

            res.json(ResponseHandler.success(result, `${result.processedData.length} districts fayldan uğurla emal edildi`));
        } catch (error) {
            next(error);
        }
    }

    countDistrictsRates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.districtUseCase.countDistrictsRates();

            res.json(ResponseHandler.success({}, 'Hesablama uğurla tamamlandı'));
        } catch (error) {
            next(error);
        }
    }

    checkExistingDistrictCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const existingCodes = await this.districtUseCase.checkExistingDistrictCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Kodlar uğurla yoxlanıldı'));
        } catch (error) {
            next(error);
        }
    }

    uploadAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.districtId, id)) {
                if (req.file) fs.unlinkSync(req.file.path);
                res.status(403).json(ResponseHandler.error('Yalnız öz rayonunuzun fotosunu dəyişə bilərsiniz'));
                return;
            }

            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const avatarUrl = await saveEntityAvatarPg('districts', parseInt(id, 10), req.file, '/uploads/districts/avatars');

            if (!avatarUrl) {
                res.status(404).json(ResponseHandler.notFound('Rayon tapılmadı'));
                return;
            }

            res.json(ResponseHandler.success({ avatarUrl }, 'Avatar uğurla yükləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.districtId, id)) {
                res.status(403).json(ResponseHandler.error('Yalnız öz rayonunuzun fotosunu dəyişə bilərsiniz'));
                return;
            }

            const found = await removeEntityAvatarPg('districts', parseInt(id, 10));

            if (!found) {
                res.status(404).json(ResponseHandler.notFound('Rayon tapılmadı'));
                return;
            }

            res.json(ResponseHandler.deleted('Avatar uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }
}

// Legacy exports for backward compatibility
const districtController = new DistrictController();

export const createAllDistricts = districtController.processDistrictsFromExcel;
export const getDistricts = districtController.getDistricts;
export const getDistrictsForFilter = districtController.getDistrictsForFilter;
export const getDistrictById = districtController.getDistrictById;
export const updateDistrictsStats = districtController.updateDistrictsStats;
export const createDistrict = districtController.createDistrict;
export const updateDistrict = districtController.updateDistrict;
export const updateDistrictProfile = districtController.updateProfile;
export const deleteDistrict = districtController.deleteDistrict;
export const deleteDistricts = districtController.deleteDistricts;
export const processDistrictsFromExcel = districtController.processDistrictsFromExcel;
export const countDistrictsRates = districtController.countDistrictsRates;
export const checkExistingDistrictCodes = districtController.checkExistingDistrictCodes;
export const uploadDistrictAvatar = districtController.uploadAvatar;
export const deleteDistrictAvatar = districtController.deleteAvatar;
