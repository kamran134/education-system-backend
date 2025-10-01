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
exports.TeacherUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
const mongoose_1 = require("mongoose");
class TeacherUseCase {
    constructor(teacherService) {
        this.teacherService = teacherService;
    }
    updateTeachersStats() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.teacherService.updateTeachersStats();
        });
    }
    getTeachers(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data, totalCount } = yield this.teacherService.getFilteredTeachers(pagination, filters, sort);
            return {
                data,
                totalCount,
                page: pagination.page,
                size: pagination.size,
                totalPages: Math.ceil(totalCount / pagination.size)
            };
        });
    }
    getTeacherById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Teacher ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Teacher ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const teacher = yield this.teacherService.findById(id);
            if (!teacher) {
                throw new Error('Teacher not found');
            }
            return teacher;
        });
    }
    createTeacher(teacherData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = this.validateTeacherData(teacherData);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingTeacher = yield this.teacherService.findByCode(teacherData.code);
            if (existingTeacher) {
                throw new Error('Teacher with this code already exists');
            }
            return yield this.teacherService.create(teacherData);
        });
    }
    updateTeacher(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Teacher ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Teacher ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingTeacher = yield this.teacherService.findById(id);
            if (!existingTeacher) {
                throw new Error('Teacher not found');
            }
            if (updateData.code && updateData.code !== existingTeacher.code) {
                const codeExists = yield this.teacherService.findByCode(updateData.code);
                if (codeExists) {
                    throw new Error('Teacher with this code already exists');
                }
            }
            return yield this.teacherService.update(id, updateData);
        });
    }
    deleteTeacher(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Teacher ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Teacher ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const teacher = yield this.teacherService.findById(id);
            if (!teacher) {
                throw new Error('Teacher not found');
            }
            yield this.teacherService.delete(id);
        });
    }
    deleteTeachers(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            const arrayValidation = validation_util_1.ValidationUtils.validateArray(ids, 'Teacher IDs', 1);
            if (!arrayValidation.isValid) {
                throw new Error(arrayValidation.errors.join(', '));
            }
            const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
            return yield this.teacherService.deleteBulk(objectIds);
        });
    }
    processTeachersFromFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!filePath) {
                throw new Error('File path is required');
            }
            return yield this.teacherService.processTeachersFromExcel(filePath);
        });
    }
    repairTeachers() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.teacherService.repairTeacherAssignments();
        });
    }
    getTeachersForFilter(filters) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.teacherService.getTeachersForFilter(filters);
        });
    }
    validateTeacherData(data) {
        return validation_util_1.ValidationUtils.combine([
            validation_util_1.ValidationUtils.validateRequired(data.fullname, 'Full name'),
            validation_util_1.ValidationUtils.validateRequired(data.code, 'Teacher code'),
            validation_util_1.ValidationUtils.validateCode(data.code, 7, 7)
        ]);
    }
}
exports.TeacherUseCase = TeacherUseCase;
