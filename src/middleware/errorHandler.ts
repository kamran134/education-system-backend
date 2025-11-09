import { NextFunction, Request, Response } from "express";
import { Error as MongooseError } from "mongoose";

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
    console.error('Error:', err);

    // Mongoose validation error
    if (err instanceof MongooseError.ValidationError) {
        const errors = Object.values(err.errors).map((e: any) => {
            if (e.kind === 'required') {
                return `${e.path} tələb olunur`;
            }
            return e.message;
        });
        res.status(400).json({ 
            success: false,
            message: errors.join(', ') 
        });
        return;
    }

    // Mongoose cast error
    if (err.name === 'CastError') {
        res.status(400).json({ 
            success: false,
            message: `Yanlış ${err.path} formatı` 
        });
        return;
    }

    // Duplicate key error
    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        res.status(400).json({ 
            success: false,
            message: `${field} artıq mövcuddur` 
        });
        return;
    }

    // Default error
    res.status(err.status || 500).json({ 
        success: false,
        message: err.message || "500: Daxili server xətası" 
    });
}