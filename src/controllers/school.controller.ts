import { Request, Response, NextFunction } from 'express';
import { SchoolService } from '../services/school.service';
import { SchoolRepository } from '../repositories/school.repository';
import School from '../models/school.model';
import { CreateSchoolDto, UpdateSchoolDto } from '../dtos/school.dto';
import { validateDto } from '../middleware/validation.middleware';
import { AppError } from '../utils/errors';

const schoolRepository = new SchoolRepository(School);
const schoolService = new SchoolService(schoolRepository);

export const getSchools = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await schoolService.getSchools(req);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const getSchool = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const school = await schoolService.getSchool(req.params.id);
        res.status(200).json(school);
    } catch (error) {
        next(error);
    }
};

export const createSchool = [
    validateDto(CreateSchoolDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const school = await schoolService.createSchool(req.body);
            res.status(201).json(school);
        } catch (error) {
            next(error);
        }
    }
];

export const updateSchool = [
    validateDto(UpdateSchoolDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const school = await schoolService.updateSchool(req.params.id, req.body);
            res.status(200).json(school);
        } catch (error) {
            next(error);
        }
    }
];

export const deleteSchool = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const success = await schoolService.deleteSchool(req.params.id);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'School not found');
        }
    } catch (error) {
        next(error);
    }
};

export const deleteSchools = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            throw new AppError(400, 'Invalid request body. Expected an array of school IDs.');
        }
        const success = await schoolService.deleteSchools(ids);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'No schools found to delete');
        }
    } catch (error) {
        next(error);
    }
};