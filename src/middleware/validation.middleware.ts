import { Request, Response, NextFunction } from 'express';
import { validate, ValidationError } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ValidationError as CustomValidationError } from '../utils/errors';

export const validateDto = (dtoClass: any) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const dtoObject = plainToClass(dtoClass, req.body);
        const errors = await validate(dtoObject, { skipMissingProperties: true });

        if (errors.length > 0) {
            const errorMessages = errors
                .map((error: ValidationError) => {
                    if (error.constraints) {
                        return Object.values(error.constraints);
                    }
                    return [];
                })
                .flat();

            throw new CustomValidationError(errorMessages.join(', '));
        }

        req.body = dtoObject;
        next();
    };
}; 