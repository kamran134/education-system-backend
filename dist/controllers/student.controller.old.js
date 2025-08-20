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
exports.repairStudents = exports.deleteAllStudents = exports.deleteStudents = exports.deleteStudent = exports.updateStudent = exports.createStudent = exports.searchStudents = exports.getStudent = exports.getStudents = void 0;
const student_model_1 = __importDefault(require("../models/student.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const studentResult_model_1 = __importDefault(require("../models/studentResult.model"));
const student_service_1 = require("../services/student.service");
const studentResult_service_1 = require("../services/studentResult.service");
const getStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, totalCount } = yield (0, student_service_1.getFiltredStudents)(req);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Tələbələrin alınmasında xəta", error });
    }
});
exports.getStudents = getStudents;
const getStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const student = yield student_model_1.default
            .findById(req.params.id)
            .populate('district school teacher');
        if (!student) {
            res.status(404).json({ message: "Tələbə tapılmadı!" });
        }
        else {
            let studentWithResults;
            const studentResults = yield studentResult_model_1.default.find({ student: student._id }).populate('exam');
            if (studentResults) {
                studentWithResults = Object.assign(Object.assign({}, student.toObject()), { results: studentResults });
            }
            else {
                studentWithResults = Object.assign(Object.assign({}, student.toObject()), { results: [] });
            }
            res.status(200).json(studentWithResults);
        }
    }
    catch (error) {
        res.status(500).json({ message: "Tələbə tapılmadı!", error });
    }
});
exports.getStudent = getStudent;
// export const getStudentsForStats = async (req: Request, res: Response) => {
//     try {
//         const { data, totalCount } = await getFiltredStudents(req); 
//         res.status(200).json({ data, totalCount });
//     }
//     catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Tələbələrin alınmasında xəta", error });
//     }
// }
const searchStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const searchString = req.params.searchString || '';
        const students = yield student_model_1.default.aggregate([
            {
                $addFields: {
                    fullName: {
                        $concat: ['$lastName', ' ', '$firstName', ' ', '$middleName'],
                    },
                },
            },
            {
                $match: {
                    fullName: { $regex: searchString, $options: 'i' },
                },
            },
            {
                $lookup: {
                    from: 'teachers', // Название коллекции учителей
                    localField: 'teacher', // Поле в коллекции студентов
                    foreignField: '_id', // Поле в коллекции учителей
                    as: 'teacher', // Название поля для результата
                },
            },
            {
                $unwind: {
                    path: '$teacher', // Разворачиваем массив (так как $lookup возвращает массив)
                    preserveNullAndEmptyArrays: true, // Сохраняем документы, даже если teacher не найден
                },
            },
            {
                $lookup: {
                    from: 'schools', // Название коллекции школ
                    localField: 'school', // Поле в коллекции студентов
                    foreignField: '_id', // Поле в коллекции школ
                    as: 'school', // Название поля для результата
                },
            },
            {
                $unwind: {
                    path: '$school', // Разворачиваем массив
                    preserveNullAndEmptyArrays: true, // Сохраняем документы, даже если school не найдена
                },
            },
            {
                $lookup: {
                    from: 'districts', // Название коллекции районов
                    localField: 'district', // Поле в коллекции студентов
                    foreignField: '_id', // Поле в коллекции районов
                    as: 'district', // Название поля для результата
                },
            },
            {
                $unwind: {
                    path: '$district', // Разворачиваем массив
                    preserveNullAndEmptyArrays: true, // Сохраняем документы, даже если district не найден
                },
            }
        ]);
        res.status(200).json({ data: students, totalCount: students.length });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Axtarış zamanı xəta!" });
    }
});
exports.searchStudents = searchStudents;
const createStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const student = req.body;
        // first we check if student code is valid
        const studentCode = student.code.toString();
        if (studentCode.length !== 10) {
            res.status(400).json({ message: "Tələbə kodu minimum 10 ədədli rəqəm olmalıdır" });
            return;
        }
        // check if student already exists
        const existingStudent = yield student_model_1.default.findOne({ code: student.code });
        if (existingStudent) {
            res.status(400).json({ message: "Bu kodda tələbə artıq var" });
            return;
        }
        // then we check if teacher district and school are valid
        if (student.district) {
            const district = yield district_model_1.default.findById(student.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }
        if (student.school) {
            const school = yield school_model_1.default.findById(student.school);
            if (!school) {
                res.status(400).json({ message: "Bu kodda məktəb tapılmadı" });
                return;
            }
        }
        if (student.teacher) {
            const teacher = yield teacher_model_1.default.findById(student.teacher);
            if (!teacher) {
                res.status(400).json({ message: "Bu kodda müəllim tapılmadı" });
                return;
            }
        }
        const newStudent = new student_model_1.default(student);
        yield newStudent.save();
        res.status(201).json(newStudent);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Tələbə yaradılarkən xəta baş verdi", error });
    }
});
exports.createStudent = createStudent;
const updateStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const student = req.body;
        // first we check if teacher district and school are valid and changed
        if (student.district) {
            const district = yield district_model_1.default.findById(student.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }
        if (student.school) {
            const school = yield school_model_1.default.findById(student.school);
            if (!school) {
                res.status(400).json({ message: "Bu kodda məktəb tapılmadı" });
                return;
            }
        }
        if (student.teacher) {
            const teacher = yield teacher_model_1.default.findById(student.teacher);
            if (!teacher) {
                res.status(400).json({ message: "Bu kodda müəllim tapılmadı" });
                return;
            }
        }
        // check changed fields of teacher
        const existingStudent = yield student_model_1.default.findById(id);
        if (!existingStudent) {
            res.status(404).json({ message: "Şagird tapılmadı" });
            return;
        }
        let isUpdated = false;
        if (existingStudent.district !== student.district) {
            existingStudent.district = student.district;
            isUpdated = true;
        }
        if (existingStudent.school !== student.school) {
            existingStudent.school = student.school;
            isUpdated = true;
        }
        if (existingStudent.teacher !== student.teacher) {
            existingStudent.teacher = student.teacher;
            isUpdated = true;
        }
        if (existingStudent.code !== student.code) {
            existingStudent.code = student.code;
            isUpdated = true;
        }
        if (existingStudent.lastName !== student.lastName || existingStudent.firstName !== student.firstName || existingStudent.middleName !== student.middleName) {
            existingStudent.lastName = student.lastName;
            existingStudent.firstName = student.firstName;
            existingStudent.middleName = student.middleName;
            isUpdated = true;
        }
        if (isUpdated) {
            yield existingStudent.save();
            res.status(200).json(existingStudent);
            return;
        }
    }
    catch (error) {
        res.status(500).json({ message: "Şagirdin yenilənməsində xəta", error });
    }
});
exports.updateStudent = updateStudent;
const deleteStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentResults = yield (0, studentResult_service_1.deleteStudentResultsByStudentId)(req.params.id);
        const result = yield student_model_1.default.findByIdAndDelete(req.params.id);
        res.status(200).json({ result, studentResults });
    }
    catch (error) {
        console.error(error);
        res.status(500).json(error);
    }
});
exports.deleteStudent = deleteStudent;
const deleteStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { studentIds } = req.params;
        if (studentIds.length === 0) {
            res.status(400).json({ message: "Şagirdlər seçilməyib" });
            return;
        }
        const studentIdsArr = studentIds.split(",");
        const { result, studentResults } = yield (0, student_service_1.deleteStudentsByIds)(studentIdsArr);
        if (result && result.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən şagirdlər bazada tapılmadı" });
            return;
        }
        res.status(200).json({ message: `${result.deletedCount} şagird və ${studentResults.deletedCount} onların nəticələri bazadan silindi!` });
    }
    catch (error) {
        console.error(error);
        res.status(500).json(error);
    }
});
exports.deleteStudents = deleteStudents;
const deleteAllStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentResult = yield studentResult_model_1.default.deleteMany();
        const result = yield student_model_1.default.deleteMany();
        res.status(200).json({ message: `${result.deletedCount} şagird və ${studentResult.deletedCount} onların nəticələri bazadan silindi!` });
    }
    catch (error) {
        console.error(error);
        res.status(500).json(error);
    }
});
exports.deleteAllStudents = deleteAllStudents;
const repairStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const students = yield student_model_1.default.find().populate('district school teacher');
        const studentsWithoutDistrict = [];
        const studentsWithoutSchool = [];
        const studentsWithoutTeacher = [];
        const repairedStudents = [];
        for (let student of students) {
            const studentCode = student.code.toString();
            if (studentCode.length !== 10)
                continue;
            let isUpdated = false;
            if (!student.district) {
                const districtCode = studentCode.substring(0, 3);
                const district = yield district_model_1.default.findOne({ code: districtCode });
                if (district) {
                    student.district = district;
                    isUpdated = true;
                }
                else {
                    studentsWithoutDistrict.push(student.code.toString());
                }
            }
            if (!student.school) {
                const schoolCode = studentCode.substring(0, 5);
                const school = yield school_model_1.default.findOne({ code: schoolCode });
                if (school) {
                    student.school = school;
                    isUpdated = true;
                }
                else {
                    studentsWithoutSchool.push(student.code.toString());
                }
            }
            if (!student.teacher) {
                const teacherCode = studentCode.substring(0, 7);
                const teacher = yield teacher_model_1.default.findOne({ code: teacherCode });
                if (teacher) {
                    student.teacher = teacher;
                    isUpdated = true;
                }
                else {
                    studentsWithoutTeacher.push(student.code.toString());
                }
            }
            if (isUpdated) {
                yield student.save();
                repairedStudents.push(student.code.toString());
            }
        }
        res.status(200).json({
            message: "Tələbə məlumatları yeniləndi",
            repairedStudents,
            studentsWithoutDistrict,
            studentsWithoutSchool,
            studentsWithoutTeacher
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Tələbələrin alınmasında xəta", error });
    }
});
exports.repairStudents = repairStudents;
