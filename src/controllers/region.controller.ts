import { Request, Response, NextFunction } from "express";
import fs from "fs";
import { RegionUseCase } from "../usecases/region.usecase";
import { RegionServicePg } from "../services/region.service.pg";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";
import { saveEntityAvatarPg, removeEntityAvatarPg, canManageOwnEntity } from "../utils/avatar.util";
import { canViewEntity } from "../utils/hierarchy-access.util";

export class RegionController {
    private regionUseCase: RegionUseCase;

    constructor() {
        this.regionUseCase = new RegionUseCase(new RegionServicePg());
    }

    getRegions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptionsPg(req);
            const sort = RequestParser.parseSorting(req, 'name', 'asc');

            const result = await this.regionUseCase.getFilteredRegions(pagination, filters, sort);

            res.json(ResponseHandler.success({
                data: result.data,
                totalCount: result.totalCount
            }, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getRegionsForFilter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = RequestParser.parseFilterOptionsPg(req);
            const regions = await this.regionUseCase.getRegionsForFilter(filters);

            res.json(ResponseHandler.success(regions, 'Filtr üçün məlumatlar uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    getRegionById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const region = await this.regionUseCase.getRegionById(id);

            const canView = await canViewEntity(req.user, 'region', region.id);
            if (!canView) {
                res.status(403).json(ResponseHandler.error('Bu profilə baxmaq icazəniz yoxdur'));
                return;
            }

            res.json(ResponseHandler.success(region, 'Məlumat uğurla alındı'));
        } catch (error) {
            next(error);
        }
    }

    createRegion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const regionData = req.body;
            const region = await this.regionUseCase.createRegion(regionData);

            res.status(201).json(ResponseHandler.created(region, 'Məlumat uğurla yaradıldı'));
        } catch (error) {
            next(error);
        }
    }

    updateRegion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const region = await this.regionUseCase.updateRegion(id, updateData);

            res.json(ResponseHandler.updated(region, 'Məlumat uğurla yeniləndi'));
        } catch (error) {
            next(error);
        }
    }

    deleteRegion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            await this.regionUseCase.deleteRegion(id);

            res.json(ResponseHandler.deleted('Məlumat uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }

    deleteRegions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { ids } = req.body;
            const result = await this.regionUseCase.deleteRegions(ids);

            res.json(ResponseHandler.success(result, ` məlumat uğurla silindi`));
        } catch (error) {
            next(error);
        }
    }

    checkExistingRegionCodes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { codes } = req.body;
            const existingCodes = await this.regionUseCase.checkExistingRegionCodes(codes);

            res.json(ResponseHandler.success(existingCodes, 'Kodlar uğurla yoxlanıldı'));
        } catch (error) {
            next(error);
        }
    }

    uploadAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            if (!canManageOwnEntity(req.user?.role, req.user?.regionId, id)) {
                if (req.file) fs.unlinkSync(req.file.path);
                res.status(403).json(ResponseHandler.error('Yalnız öz regional idarənizin fotosunu dəyişə bilərsiniz'));
                return;
            }

            if (!req.file) {
                res.status(400).json(ResponseHandler.badRequest('Fayl yüklənməyib'));
                return;
            }

            const avatarUrl = await saveEntityAvatarPg('regions', parseInt(id, 10), req.file, '/uploads/regions/avatars');

            if (!avatarUrl) {
                res.status(404).json(ResponseHandler.notFound('Regional idarə tapılmadı'));
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

            if (!canManageOwnEntity(req.user?.role, req.user?.regionId, id)) {
                res.status(403).json(ResponseHandler.error('Yalnız öz regional idarənizin fotosunu dəyişə bilərsiniz'));
                return;
            }

            const found = await removeEntityAvatarPg('regions', parseInt(id, 10));

            if (!found) {
                res.status(404).json(ResponseHandler.notFound('Regional idarə tapılmadı'));
                return;
            }

            res.json(ResponseHandler.deleted('Avatar uğurla silindi'));
        } catch (error) {
            next(error);
        }
    }
}

const regionController = new RegionController();

export const getRegions = regionController.getRegions;
export const getRegionsForFilter = regionController.getRegionsForFilter;
export const getRegionById = regionController.getRegionById;
export const createRegion = regionController.createRegion;
export const updateRegion = regionController.updateRegion;
export const deleteRegion = regionController.deleteRegion;
export const deleteRegions = regionController.deleteRegions;
export const checkExistingRegionCodes = regionController.checkExistingRegionCodes;
export const uploadRegionAvatar = regionController.uploadAvatar;
export const deleteRegionAvatar = regionController.deleteAvatar;
