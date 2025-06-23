import { Request, Response, NextFunction } from 'express';
import { DistrictService } from '../services/district.service';
import { DistrictRepository } from '../repositories/district.repository';
import District from '../models/district.model';
import { CreateDistrictDto, UpdateDistrictDto } from '../dtos/district.dto';
import { validateDto } from '../middleware/validation.middleware';
import { AppError } from '../utils/errors';

const districtRepository = new DistrictRepository(District);
const districtService = new DistrictService(districtRepository);

export const getDistricts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await districtService.getDistricts(req);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const getDistrict = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const district = await districtService.getDistrict(req.params.id);
        res.status(200).json(district);
    } catch (error) {
        next(error);
    }
};

export const createDistrict = [
    validateDto(CreateDistrictDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const district = await districtService.createDistrict(req.body);
            res.status(201).json(district);
        } catch (error) {
            next(error);
        }
    }
];

export const updateDistrict = [
    validateDto(UpdateDistrictDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const district = await districtService.updateDistrict(req.params.id, req.body);
            res.status(200).json(district);
        } catch (error) {
            next(error);
        }
    }
];

export const deleteDistrict = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const success = await districtService.deleteDistrict(req.params.id);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'District not found');
        }
    } catch (error) {
        next(error);
    }
};

export const deleteDistricts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            throw new AppError(400, 'Invalid request body. Expected an array of district IDs.');
        }
        const success = await districtService.deleteDistricts(ids);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'No districts found to delete');
        }
    } catch (error) {
        next(error);
    }
};