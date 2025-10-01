"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchoolUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
const mongoose_1 = require("mongoose");
class SchoolUseCase {
    constructor(schoolService) {
        this.schoolService = schoolService;
    }
    updateSchoolsStats() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.schoolService.updateSchoolsStats();
        });
    }
    getSchools(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data, totalCount } = yield this.schoolService.getFilteredSchools(pagination, filters, sort);
            return {
                data,
                totalCount,
                page: pagination.page,
                size: pagination.size,
                totalPages: Math.ceil(totalCount / pagination.size)
            };
        });
    }
    getSchoolById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'School ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'School ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const school = yield this.schoolService.findById(id);
            if (!school) {
                throw new Error('School not found');
            }
            return school;
        });
    }
    createSchool(schoolData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = this.validateSchoolData(schoolData);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingSchool = yield this.schoolService.findByCode(schoolData.code);
            if (existingSchool) {
                throw new Error('School with this code already exists');
            }
            return yield this.schoolService.create(schoolData);
        });
    }
    updateSchool(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'School ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'School ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingSchool = yield this.schoolService.findById(id);
            if (!existingSchool) {
                throw new Error('School not found');
            }
            if (updateData.code && updateData.code !== existingSchool.code) {
                const codeExists = yield this.schoolService.findByCode(updateData.code);
                if (codeExists) {
                    throw new Error('School with this code already exists');
                }
            }
            return yield this.schoolService.update(id, updateData);
        });
    }
    deleteSchool(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'School ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'School ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const school = yield this.schoolService.findById(id);
            if (!school) {
                throw new Error('School not found');
            }
            yield this.schoolService.delete(id);
        });
    }
    deleteSchools(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            const arrayValidation = validation_util_1.ValidationUtils.validateArray(ids, 'School IDs', 1);
            if (!arrayValidation.isValid) {
                throw new Error(arrayValidation.errors.join(', '));
            }
            const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
            return yield this.schoolService.deleteBulk(objectIds);
        });
    }
    processSchoolsFromFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filePath) {
                throw new Error('File path is required');
            }
            return yield this.schoolService.processSchoolsFromExcel(filePath);
        });
    }
    getSchoolsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.schoolService.getSchoolsForFilter(filters);
        });
    }
    validateSchoolData(data) {
        return validation_util_1.ValidationUtils.combine([
            validation_util_1.ValidationUtils.validateRequired(data.name, 'School name'),
            validation_util_1.ValidationUtils.validateRequired(data.code, 'School code'),
            validation_util_1.ValidationUtils.validateCode(data.code, 5, 5),
            validation_util_1.ValidationUtils.validateRequired(data.district, 'District')
        ]);
    }
}
exports.SchoolUseCase = SchoolUseCase;
