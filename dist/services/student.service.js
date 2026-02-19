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
    // Функция для расчета мест с учетом одинаковых баллов
    assignPlaces(items, scoreField = 'averageScore') {
        if (items.length === 0)
            return items;
        // Create a sorted copy by score to determine places WITHOUT modifying original array order
        const sortedByScore = [...items].sort((a, b) => {
            const scoreA = a[scoreField] || 0;
            const scoreB = b[scoreField] || 0;
            return scoreB - scoreA; // Descending order (higher score = better place)
        });
        // Build a map of scores to places
        const scorePlaceMap = new Map();
        let currentPlace = 1;
        let previousScore = null;
        sortedByScore.forEach((item, index) => {
            const currentScore = item[scoreField] || 0;
            if (index === 0) {
                // First element always gets place 1
                scorePlaceMap.set(currentScore, 1);
                previousScore = currentScore;
            }
            else if (currentScore < previousScore) {
                // Score is lower - increment place first, then assign
                currentPlace++;
                scorePlaceMap.set(currentScore, currentPlace);
                previousScore = currentScore;
            }
            else {
                // Same score - same place (don't increment)
                scorePlaceMap.set(currentScore, currentPlace);
            }
        });
        // Assign places to original items WITHOUT changing their order
        items.forEach(item => {
            const score = item[scoreField] || 0;
            item.place = scorePlaceMap.get(score) || null;
        });
        return items;
    }
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
            const searchTerms = searchString.trim().split(/\s+/);
            let matchCondition;
            if (searchTerms.length === 1) {
                // Single word search
                matchCondition = {
                    $or: [
                        { firstName: { $regex: searchTerms[0], $options: 'i' } },
                        { lastName: { $regex: searchTerms[0], $options: 'i' } },
                        { middleName: { $regex: searchTerms[0], $options: 'i' } },
                        { code: parseInt(searchTerms[0]) || 0 }
                    ]
                };
            }
            else {
                // Multiple words - each word must be found in firstName, lastName, or middleName
                const nameConditions = searchTerms.map(term => ({
                    $or: [
                        { firstName: { $regex: term, $options: 'i' } },
                        { lastName: { $regex: term, $options: 'i' } },
                        { middleName: { $regex: term, $options: 'i' } }
                    ]
                }));
                matchCondition = {
                    $and: nameConditions
                };
            }
            return yield student_model_1.default.aggregate([
                {
                    $match: matchCondition
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
            console.log('👨‍🎓 getFilteredStudents called with filters:', JSON.stringify(filters, null, 2));
            const filter = this.buildFilter(filters);
            console.log('👨‍🎓 Built MongoDB filter:', JSON.stringify(filter, null, 2));
            // Build aggregation pipeline to include participationCount
            const pipeline = [
                // Filter students
                { $match: filter },
                // Lookup student results to count participations
                {
                    $lookup: {
                        from: 'studentresults',
                        localField: '_id',
                        foreignField: 'student',
                        as: 'results'
                    }
                },
                // Add participationCount field
                {
                    $addFields: {
                        participationCount: { $size: '$results' }
                    }
                },
                // Lookup teacher
                {
                    $lookup: {
                        from: 'teachers',
                        localField: 'teacher',
                        foreignField: '_id',
                        as: 'teacher'
                    }
                },
                { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
                // Lookup school
                {
                    $lookup: {
                        from: 'schools',
                        localField: 'school',
                        foreignField: '_id',
                        as: 'school'
                    }
                },
                { $unwind: { path: '$school', preserveNullAndEmptyArrays: true } },
                // Lookup district
                {
                    $lookup: {
                        from: 'districts',
                        localField: 'district',
                        foreignField: '_id',
                        as: 'district'
                    }
                },
                { $unwind: { path: '$district', preserveNullAndEmptyArrays: true } },
                // Remove results array (we only need the count)
                {
                    $project: {
                        results: 0
                    }
                }
            ];
            // Execute pipeline to get all filtered data
            const allData = yield student_model_1.default.aggregate(pipeline).collation({ locale: 'az', strength: 2 });
            console.log('👨‍🎓 Found students:', allData.length);
            // Sort in JavaScript with Azerbaijani locale for proper text sorting
            allData.sort((a, b) => {
                let aVal = a;
                let bVal = b;
                // Navigate to nested field if needed
                const fieldPath = sort.sortColumn.split('.');
                for (const key of fieldPath) {
                    aVal = aVal === null || aVal === void 0 ? void 0 : aVal[key];
                    bVal = bVal === null || bVal === void 0 ? void 0 : bVal[key];
                }
                // Handle null/undefined values
                if (aVal == null && bVal == null)
                    return 0;
                if (aVal == null)
                    return sort.sortDirection === 'asc' ? -1 : 1;
                if (bVal == null)
                    return sort.sortDirection === 'asc' ? 1 : -1;
                // Sort based on type
                if (typeof aVal === 'string' && typeof bVal === 'string') {
                    const comparison = aVal.localeCompare(bVal, 'az', { sensitivity: 'base' });
                    return sort.sortDirection === 'asc' ? comparison : -comparison;
                }
                else if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }
                else {
                    // Fallback for other types
                    return sort.sortDirection === 'asc' ?
                        (aVal > bVal ? 1 : -1) :
                        (aVal < bVal ? 1 : -1);
                }
            });
            // Recalculate places based on score for filtered data
            this.assignPlaces(allData, 'score');
            // Apply pagination after place calculation
            const paginatedData = allData.slice(pagination.skip, pagination.skip + pagination.size);
            const totalCount = allData.length;
            return { data: paginatedData, totalCount };
        });
    }
    repairStudentAssignments() {
        return __awaiter(this, void 0, void 0, function* () {
            // Find students with missing teacher, school, or district
            const students = yield student_model_1.default.find({
                $or: [
                    { teacher: { $exists: false } },
                    { teacher: null },
                    { school: { $exists: false } },
                    { school: null },
                    { district: { $exists: false } },
                    { district: null }
                ]
            });
            console.log(`Found ${students.length} students with missing assignments`);
            const repairedStudents = [];
            const failedStudents = [];
            const missedDistricts = [];
            const missedSchools = [];
            const missedTeachers = [];
            // Pre-fetch all teachers, schools, and districts
            const allTeachers = yield teacher_model_1.default.find({});
            const allSchools = yield school_model_1.default.find({});
            const allDistricts = yield district_model_1.default.find({});
            // Create maps for quick lookup by CODE
            const teacherMap = new Map(allTeachers.map(t => [t.code, t]));
            const schoolMap = new Map(allSchools.map(s => [s.code, s]));
            const districtMap = new Map(allDistricts.map(d => [d.code, d]));
            for (const student of students) {
                try {
                    const studentCode = student.code;
                    let hasChanges = false;
                    // Extract codes from student code
                    const teacherCode = Math.floor(studentCode / 1000); // 1500188
                    const schoolCode = Math.floor(studentCode / 100000); // 15001
                    const districtCode = Math.floor(studentCode / 10000000); // 150
                    console.log(`Processing student ${studentCode}: teacher=${teacherCode}, school=${schoolCode}, district=${districtCode}`);
                    // Assign teacher if missing
                    if (!student.teacher) {
                        const teacher = teacherMap.get(teacherCode);
                        if (teacher) {
                            student.teacher = teacher._id;
                            hasChanges = true;
                            console.log(`  ✓ Assigned teacher ${teacherCode}`);
                        }
                        else {
                            console.log(`  ✗ Teacher ${teacherCode} not found`);
                            missedTeachers.push(studentCode);
                        }
                    }
                    // Assign school if missing
                    if (!student.school) {
                        const school = schoolMap.get(schoolCode);
                        if (school) {
                            student.school = school._id;
                            hasChanges = true;
                            console.log(`  ✓ Assigned school ${schoolCode}`);
                        }
                        else {
                            console.log(`  ✗ School ${schoolCode} not found`);
                            missedSchools.push(studentCode);
                        }
                    }
                    // Assign district if missing
                    if (!student.district) {
                        const district = districtMap.get(districtCode);
                        if (district) {
                            student.district = district._id;
                            hasChanges = true;
                            console.log(`  ✓ Assigned district ${districtCode}`);
                        }
                        else {
                            console.log(`  ✗ District ${districtCode} not found`);
                            missedDistricts.push(studentCode);
                        }
                    }
                    // Save if there were changes
                    if (hasChanges) {
                        yield student.save();
                        repairedStudents.push(studentCode);
                        console.log(`✓ Saved student ${studentCode}`);
                    }
                }
                catch (error) {
                    console.error(`Error processing student ${student.code}:`, error);
                    failedStudents.push({
                        code: student.code,
                        reason: `Error: ${error instanceof Error ? error.message : 'Unknown'}`
                    });
                }
            }
            console.log(`Repair complete: ${repairedStudents.length} repaired`);
            console.log(`  Missed teachers: ${missedTeachers.length}`);
            console.log(`  Missed schools: ${missedSchools.length}`);
            console.log(`  Missed districts: ${missedDistricts.length}`);
            return {
                repairedStudents,
                failedStudents,
                missedDistricts,
                missedSchools,
                missedTeachers
            };
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
        // Приоритет фильтров: teacherIds > schoolIds > districtIds
        // Используем самый специфичный фильтр из доступных
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            filter.teacher = { $in: filters.teacherIds };
        }
        else if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }
        else if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }
        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }
        if (filters.code) {
            const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }
        // Поиск по имени, фамилии, отчеству или коду
        if (filters.search) {
            const searchTrim = filters.search.trim();
            // Check if search is a number (code search)
            if (/^\d+$/.test(searchTrim)) {
                const code = parseInt(searchTrim);
                const { start, end } = request_parser_util_1.RequestParser.parseCodeRange(code, 10);
                filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
            }
            else {
                // Text search by name
                const searchTerms = searchTrim.split(/\s+/);
                if (searchTerms.length === 1) {
                    // Single word search
                    filter.$or = [
                        { firstName: { $regex: searchTerms[0], $options: 'i' } },
                        { lastName: { $regex: searchTerms[0], $options: 'i' } },
                        { middleName: { $regex: searchTerms[0], $options: 'i' } }
                    ];
                }
                else {
                    // Multiple words - each word must be found in firstName, lastName, or middleName
                    const nameConditions = searchTerms.map(term => ({
                        $or: [
                            { firstName: { $regex: term, $options: 'i' } },
                            { lastName: { $regex: term, $options: 'i' } },
                            { middleName: { $regex: term, $options: 'i' } }
                        ]
                    }));
                    filter.$and = nameConditions;
                }
            }
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
        console.log('🔥 Filtering students by examIds:', filters.examIds);
        const studentsInExam = yield studentResult_model_1.default.find({ exam: { $in: filters.examIds } }).distinct('student');
        console.log('🔥 Students found in exam:', studentsInExam.length);
        console.log('🔥 Student IDs:', studentsInExam);
        filters.districtIds = undefined;
        filters.schoolIds = undefined;
        filters.teacherIds = undefined;
        const customFilter = service.buildExamFilter(filters, studentsInExam);
        console.log('🔍 Custom filter for exam students:', JSON.stringify(customFilter));
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
        console.log('✅ Filtered students count:', totalCount);
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
