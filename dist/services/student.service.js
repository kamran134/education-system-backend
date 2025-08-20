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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteStudentsByDistrictId = exports.deleteStudentsBySchoolsIds = exports.deleteStudentsBySchoolId = exports.deleteStudentsByTeachersIds = exports.deleteStudentsByTeacherId = exports.deleteStudentsByIds = exports.deleteStudentById = exports.getFiltredStudents = exports.assignTeacherToStudent = exports.StudentService = void 0;
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const student_model_1 = __importDefault(require("../models/student.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const studentResult_service_1 = require("./studentResult.service");
const request_parser_util_1 = require("../utils/request-parser.util");
class StudentService {
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield student_model_1.default.findById(id).populate('district school teacher');
        });
    }
    findByCode(code) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield student_model_1.default.findOne({ code });
        });
    }
    create(studentData) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.assignTeacherToStudent(studentData);
            const student = new student_model_1.default(studentData);
            return yield student.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedStudent = yield student_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate('district school teacher');
            if (!updatedStudent) {
                throw new Error('Student not found');
            }
            return updatedStudent;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield student_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('Student not found');
            }
        });
    }
    deleteBulk(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield student_model_1.default.deleteMany({ _id: { $in: ids } });
            return {
                insertedCount: 0,
                modifiedCount: 0,
                deletedCount: result.deletedCount || 0,
                errors: []
            };
        });
    }
    search(searchString) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield student_model_1.default.aggregate([
                {
                    $match: {
                        $or: [
                            { firstName: { $regex: searchString, $options: 'i' } },
                            { lastName: { $regex: searchString, $options: 'i' } },
                            { middleName: { $regex: searchString, $options: 'i' } },
                            { code: parseInt(searchString) || 0 }
                        ]
                    }
                },
                {
                    $lookup: {
                        from: 'teachers',
                        localField: 'teacher',
                        foreignField: '_id',
                        as: 'teacher'
                    }
                },
                {
                    $unwind: {
                        path: '$teacher',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $lookup: {
                        from: 'schools',
                        localField: 'school',
                        foreignField: '_id',
                        as: 'school'
                    }
                },
                {
                    $unwind: {
                        path: '$school',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $lookup: {
                        from: 'districts',
                        localField: 'district',
                        foreignField: '_id',
                        as: 'district'
                    }
                },
                {
                    $unwind: {
                        path: '$district',
                        preserveNullAndEmptyArrays: true
                    }
                }
            ]);
        });
    }
    getFilteredStudents(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                student_model_1.default.find(filter)
                    .populate('district school teacher')
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                student_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    repairStudentAssignments() {
        return __awaiter(this, void 0, void 0, function* () {
            const students = yield student_model_1.default.find({});
            const repairedStudents = [];
            const studentsWithoutTeacher = [];
            for (const student of students) {
                const originalStudent = Object.assign({}, student.toObject());
                yield this.assignTeacherToStudent(student);
                // Check if anything changed
                const hasChanged = String(originalStudent.teacher) !== String(student.teacher) ||
                    String(originalStudent.school) !== String(student.school) ||
                    String(originalStudent.district) !== String(student.district);
                if (hasChanged) {
                    yield student.save();
                    repairedStudents.push(student.code);
                }
                if (!student.teacher) {
                    studentsWithoutTeacher.push(student.code);
                }
            }
            return { repairedStudents, studentsWithoutTeacher };
        });
    }
    assignTeacherToStudent(student) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const teacherCode = Math.floor(student.code / 1000);
                const teacher = yield teacher_model_1.default.findOne({ code: teacherCode });
                if (teacher) {
                    student.teacher = teacher._id;
                    const studentSchool = yield school_model_1.default.findById(teacher.school);
                    if (studentSchool) {
                        student.school = studentSchool._id;
                        const studentDistrict = yield district_model_1.default.findById(studentSchool.district);
                        if (studentDistrict) {
                            student.district = studentDistrict._id;
                        }
                    }
                }
            }
            catch (error) {
                console.error(`Error assigning teacher to student ${student.code}:`, error);
            }
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.districtIds && filters.districtIds.length > 0 && (!filters.schoolIds || filters.schoolIds.length === 0)) {
            filter.district = { $in: filters.districtIds };
        }
        if (filters.schoolIds && filters.schoolIds.length > 0 && (!filters.teacherIds || filters.teacherIds.length === 0)) {
            filter.school = { $in: filters.schoolIds };
        }
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            filter.teacher = { $in: filters.teacherIds };
        }
        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        return filter;
    }
    buildExamFilter(filters, studentIds) {
        const filter = {
            _id: { $in: studentIds }
        };
        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        return filter;
    }
}
exports.StudentService = StudentService;
// Legacy functions for backward compatibility
const assignTeacherToStudent = (student) => __awaiter(void 0, void 0, void 0, function* () {
    const service = new StudentService();
    yield service.assignTeacherToStudent(student);
});
exports.assignTeacherToStudent = assignTeacherToStudent;
const getFiltredStudents = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const service = new StudentService();
    const pagination = request_parser_util_1.RequestParser.parsePagination(req);
    const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
    const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
    // Handle defective filter
    const defective = ((_a = req.query.defective) === null || _a === void 0 ? void 0 : _a.toString().toLowerCase()) === 'true';
    if (defective) {
        const filter = {
            $or: [
                { teacher: null },
                { school: null },
                { district: null },
            ]
        };
        const sortOptions = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
        const [data, totalCount] = yield Promise.all([
            student_model_1.default.find(filter)
                .populate('district school teacher')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            student_model_1.default.countDocuments(filter)
        ]);
        return { data, totalCount };
    }
    // Handle exam filter specially
    if (filters.examIds && filters.examIds.length > 0) {
        const studentsInExam = yield studentResult_model_1.default.find({ exam: { $in: filters.examIds } }).distinct('student');
        filters.districtIds = undefined;
        filters.schoolIds = undefined;
        filters.teacherIds = undefined;
        const customFilter = service.buildExamFilter(filters, studentsInExam);
        const sortOptions = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
        const [data, totalCount] = yield Promise.all([
            student_model_1.default.find(customFilter)
                .populate('district school teacher')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            student_model_1.default.countDocuments(customFilter)
        ]);
        return { data, totalCount };
    }
    return yield service.getFilteredStudents(pagination, filters, sort);
});
exports.getFiltredStudents = getFiltredStudents;
const deleteStudentById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        Promise.all([
            (0, studentResult_service_1.deleteStudentResultsByStudentId)(id),
            student_model_1.default.findByIdAndDelete(id)
        ]);
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentById = deleteStudentById;
const deleteStudentsByIds = (studentIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [result, studentResults] = yield Promise.all([
            student_model_1.default.deleteMany({ _id: { $in: studentIds } }),
            studentResult_model_1.default.deleteMany({ student: { $in: studentIds } })
        ]);
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsByIds = deleteStudentsByIds;
const deleteStudentsByTeacherId = (teacherId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentIds = yield student_model_1.default.find({ teacher: teacherId }).distinct('_id');
        const [result, studentResults] = yield Promise.all([
            student_model_1.default.deleteMany({ teacher: teacherId }),
            studentResult_model_1.default.deleteMany({ student: { $in: studentIds } })
        ]);
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsByTeacherId = deleteStudentsByTeacherId;
const deleteStudentsByTeachersIds = (teacherIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ teacher: { $in: teacherIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        const result = yield student_model_1.default.deleteMany({ teacher: { $in: teacherIds } });
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsByTeachersIds = deleteStudentsByTeachersIds;
const deleteStudentsBySchoolId = (schoolId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ school: schoolId });
        const studentIds = students.map(student => student._id);
        const studentResults = yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        const result = yield student_model_1.default.deleteMany({ school: { $in: schoolId } });
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsBySchoolId = deleteStudentsBySchoolId;
const deleteStudentsBySchoolsIds = (schoolIds) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ school: { $in: schoolIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        const result = yield student_model_1.default.deleteMany({ school: { $in: schoolIds } });
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsBySchoolsIds = deleteStudentsBySchoolsIds;
const deleteStudentsByDistrictId = (districtId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find({ district: districtId });
        const studentIds = students.map(student => student._id);
        const studentResults = yield studentResult_model_1.default.deleteMany({ student: { $in: studentIds } });
        const result = yield student_model_1.default.deleteMany({ district: { $in: districtId } });
        return { result, studentResults };
    }
    catch (error) {
        throw error;
    }
});
exports.deleteStudentsByDistrictId = deleteStudentsByDistrictId;
