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
exports.DistrictUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
const mongoose_1 = require("mongoose");
class DistrictUseCase {
    constructor(districtService) {
        this.districtService = districtService;
    }
    updateDistrictsStats() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.districtService.updateDistrictsStats();
        });
    }
    getDistrictById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'District ID');
            if (validationError) {
                throw new Error(validationError);
            }
            const district = yield this.districtService.findById(id);
            if (!district) {
                throw new Error('District not found');
            }
            return district;
        });
    }
    getDistrictByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(code, 'District code');
            const district = yield this.districtService.findByCode(code);
            if (!district) {
                throw new Error('District not found');
            }
            return district;
        });
    }
    createDistrict(districtData) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(districtData.name, 'District name');
            validation_util_1.ValidationUtils.validateRequired(districtData.code, 'District code');
            // Check if district with same code already exists
            const existingDistrict = yield this.districtService.findByCode(districtData.code);
            if (existingDistrict) {
                throw new Error('District with this code already exists');
            }
            return yield this.districtService.create(districtData);
        });
    }
    updateDistrict(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'District ID');
            if (validationError) {
                throw new Error(validationError);
            }
            // If updating code, check for conflicts
            if (updateData.code) {
                const existingDistrict = yield this.districtService.findByCode(updateData.code);
                if (existingDistrict && existingDistrict._id && existingDistrict._id.toString() !== id) {
                    throw new Error('District with this code already exists');
                }
            }
            return yield this.districtService.update(id, updateData);
        });
    }
    deleteDistrict(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'District ID');
            if (validationError) {
                throw new Error(validationError);
            }
            const district = yield this.districtService.findById(id);
            if (!district) {
                throw new Error('District not found');
            }
            yield this.districtService.delete(id);
        });
    }
    deleteDistricts(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!ids || ids.length === 0) {
                throw new Error('District IDs are required');
            }
            for (const id of ids) {
                const validationError = validation_util_1.ValidationUtils.validateObjectId(id, 'District ID');
                if (validationError) {
                    throw new Error(validationError);
                }
            }
            const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
            return yield this.districtService.deleteBulk(objectIds);
        });
    }
    getFilteredDistricts(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.districtService.getFilteredDistricts(pagination, filters, sort);
        });
    }
    getDistrictsForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.districtService.getDistrictsForFilter(filters);
        });
    }
    processDistrictsFromExcel(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            validation_util_1.ValidationUtils.validateRequired(filePath, 'File path');
            try {
                return yield this.districtService.processDistrictsFromExcel(filePath);
            }
            catch (error) {
                throw new Error(`Failed to process districts from Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    countDistrictsRates() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.districtService.countDistrictsRates();
            }
            catch (error) {
                throw new Error(`Failed to count district rates: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    checkExistingDistrictCodes(codes) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!codes || codes.length === 0) {
                return [];
            }
            return yield this.districtService.checkExistingDistrictCodes(codes);
        });
    }
}
exports.DistrictUseCase = DistrictUseCase;
