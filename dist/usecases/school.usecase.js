"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
            // If district is an object (from frontend), extract _id and code
            if (schoolData.district && typeof schoolData.district === 'object') {
                const districtObj = schoolData.district;
                schoolData.district = districtObj._id;
                schoolData.districtCode = districtObj.code;
            }
            // If districtCode is provided but not district, find district by code
            else if (schoolData.districtCode && !schoolData.district) {
                const District = (yield Promise.resolve().then(() => __importStar(require('../models/district.model')))).default;
                const district = yield District.findOne({ code: schoolData.districtCode });
                if (!district) {
                    throw new Error(`District with code ${schoolData.districtCode} not found`);
                }
                schoolData.district = district._id;
            }
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
            // If district is an object (from frontend), extract _id and code
            if (updateData.district && typeof updateData.district === 'object') {
                const districtObj = updateData.district;
                updateData.district = districtObj._id;
                updateData.districtCode = districtObj.code;
            }
            // If districtCode is provided but not district, find district by code
            else if (updateData.districtCode && !updateData.district) {
                const District = (yield Promise.resolve().then(() => __importStar(require('../models/district.model')))).default;
                const district = yield District.findOne({ code: updateData.districtCode });
                if (!district) {
                    throw new Error(`District with code ${updateData.districtCode} not found`);
                }
                updateData.district = district._id;
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
            validation_util_1.ValidationUtils.validateCode(data.code, 5, 5)
        ]);
    }
}
exports.SchoolUseCase = SchoolUseCase;
