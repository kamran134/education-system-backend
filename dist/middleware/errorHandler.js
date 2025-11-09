"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const mongoose_1 = require("mongoose");
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);
    // Mongoose validation error
    if (err instanceof mongoose_1.Error.ValidationError) {
        const errors = Object.values(err.errors).map((e) => {
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
};
exports.errorHandler = errorHandler;
