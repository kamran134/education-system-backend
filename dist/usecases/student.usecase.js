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
exports.StudentUseCase = void 0;
const validation_util_1 = require("../utils/validation.util");
const mongoose_1 = require("mongoose");
class StudentUseCase {
    constructor(studentService, studentResultService) {
        this.studentService = studentService;
        this.studentResultService = studentResultService;
    }
    getStudents(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data, totalCount } = yield this.studentService.getFilteredStudents(pagination, filters, sort);
            return {
                data,
                totalCount,
                page: pagination.page,
                size: pagination.size,
                totalPages: Math.ceil(totalCount / pagination.size)
            };
        });
    }
    getStudentById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Student ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Student ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const student = yield this.studentService.findById(id);
            if (!student) {
                throw new Error('Student not found');
            }
            const studentResults = yield this.studentResultService.getResultsByStudentId(student._id);
            return Object.assign(Object.assign({}, student.toObject()), { results: studentResults });
        });
    }
    createStudent(studentData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = this.validateStudentData(studentData);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingStudent = yield this.studentService.findByCode(studentData.code);
            if (existingStudent) {
                throw new Error('Student with this code already exists');
            }
            return yield this.studentService.create(studentData);
        });
    }
    updateStudent(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Student ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Student ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const existingStudent = yield this.studentService.findById(id);
            if (!existingStudent) {
                throw new Error('Student not found');
            }
            if (updateData.code && updateData.code !== existingStudent.code) {
                const codeExists = yield this.studentService.findByCode(updateData.code);
                if (codeExists) {
                    throw new Error('Student with this code already exists');
                }
            }
            return yield this.studentService.update(id, updateData);
        });
    }
    deleteStudent(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const validation = validation_util_1.ValidationUtils.combine([
                validation_util_1.ValidationUtils.validateRequired(id, 'Student ID'),
                validation_util_1.ValidationUtils.validateObjectId(id, 'Student ID')
            ]);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(', '));
            }
            const student = yield this.studentService.findById(id);
            if (!student) {
                throw new Error('Student not found');
            }
            // Delete associated results first
            yield this.studentResultService.deleteByStudentId(new mongoose_1.Types.ObjectId(id));
            // Then delete the student
            yield this.studentService.delete(id);
        });
    }
    deleteStudents(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            const arrayValidation = validation_util_1.ValidationUtils.validateArray(ids, 'Student IDs', 1);
            if (!arrayValidation.isValid) {
                throw new Error(arrayValidation.errors.join(', '));
            }
            const objectIds = ids.map(id => new mongoose_1.Types.ObjectId(id));
            // Delete associated results first
            yield this.studentResultService.deleteBulkByStudentIds(objectIds);
            // Then delete students
            return yield this.studentService.deleteBulk(objectIds);
        });
    }
    searchStudents(searchString) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!searchString || searchString.trim().length < 2) {
                throw new Error('Search string must be at least 2 characters long');
            }
            return yield this.studentService.search(searchString.trim());
        });
    }
    repairStudents() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.studentService.repairStudentAssignments();
        });
    }
    validateStudentData(data) {
        return validation_util_1.ValidationUtils.combine([
            validation_util_1.ValidationUtils.validateRequired(data.firstName, 'First name'),
            validation_util_1.ValidationUtils.validateRequired(data.lastName, 'Last name'),
            validation_util_1.ValidationUtils.validateRequired(data.code, 'Student code'),
            validation_util_1.ValidationUtils.validateCode(data.code, 10, 10),
            validation_util_1.ValidationUtils.validateNumber(data.grade, 'Grade', 1, 12)
        ]);
    }
}
exports.StudentUseCase = StudentUseCase;
