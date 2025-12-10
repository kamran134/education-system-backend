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
exports.bulkUploadAvatars = exports.deleteStudentAvatar = exports.uploadStudentAvatar = exports.repairStudents = exports.searchStudents = exports.deleteAllStudents = exports.deleteStudents = exports.deleteStudent = exports.updateStudent = exports.createStudent = exports.getStudent = exports.getStudents = exports.StudentController = void 0;
const student_usecase_1 = require("../usecases/student.usecase");
const student_service_1 = require("../services/student.service");
const studentResult_service_1 = require("../services/studentResult.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
const student_model_1 = __importDefault(require("../models/student.model"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const smart_crop_util_1 = require("../utils/smart-crop.util");
class StudentController {
    constructor() {
        const studentService = new student_service_1.StudentService();
        const studentResultService = new studentResult_service_1.StudentResultService();
        this.studentUseCase = new student_usecase_1.StudentUseCase(studentService, studentResultService);
    }
    getStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'averageScore', 'desc');
                // Role-based filtering
                if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) === 'districtRepresenter' && req.user.districtId) {
                    // District representer sees students from their district schools
                    filters.districtIds = [req.user.districtId];
                }
                else if (((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) === 'schoolDirector' && req.user.schoolId) {
                    // School director sees students from their school
                    filters.schoolIds = [req.user.schoolId];
                }
                else if (((_c = req.user) === null || _c === void 0 ? void 0 : _c.role) === 'teacher' && req.user.teacherId) {
                    // Teacher sees only their students
                    filters.teacherIds = [req.user.teacherId];
                }
                else if (((_d = req.user) === null || _d === void 0 ? void 0 : _d.role) === 'student' && req.user.studentId) {
                    // Student sees only themselves - filter by student ID
                    // We'll need to add this filter type
                    const studentResult = yield this.studentUseCase.getStudentById(req.user.studentId);
                    res.status(200).json(response_handler_util_1.ResponseHandler.success({
                        data: [studentResult],
                        totalCount: 1,
                        page: 1,
                        size: 1,
                        totalPages: 1
                    }));
                    return;
                }
                const result = yield this.studentUseCase.getStudents(pagination, filters, sort);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result));
            }
            catch (error) {
                console.error('Error in getStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching students', error));
            }
        });
    }
    getStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const student = yield this.studentUseCase.getStudentById(id);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(student));
            }
            catch (error) {
                console.error('Error in getStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error fetching student', error));
                }
            }
        });
    }
    createStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const studentData = req.body;
                const student = yield this.studentUseCase.createStudent(studentData);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(student, 'Student created successfully'));
            }
            catch (error) {
                console.error('Error in createStudent:', error);
                if (error.message.includes('already exists') || error.message.includes('required') || error.message.includes('must be')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error creating student', error));
                }
            }
        });
    }
    updateStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const student = yield this.studentUseCase.updateStudent(id, updateData);
                res.status(200).json(response_handler_util_1.ResponseHandler.updated(student, 'Student updated successfully'));
            }
            catch (error) {
                console.error('Error in updateStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('already exists') || error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error updating student', error));
                }
            }
        });
    }
    deleteStudent(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.studentUseCase.deleteStudent(id);
                res.status(200).json(response_handler_util_1.ResponseHandler.deleted('Student deleted successfully'));
            }
            catch (error) {
                console.error('Error in deleteStudent:', error);
                if (error.message === 'Student not found') {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound(error.message));
                }
                else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting student', error));
                }
            }
        });
    }
    deleteStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { studentIds } = req.params;
                const ids = studentIds.split(',');
                const result = yield this.studentUseCase.deleteStudents(ids);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result, 'Students deleted successfully'));
            }
            catch (error) {
                console.error('Error in deleteStudents:', error);
                if (error.message.includes('must be an array') || error.message.includes('at least')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting students', error));
                }
            }
        });
    }
    deleteAllStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // This is a dangerous operation, should be protected with special authorization
                // For now, we'll just return an error
                res.status(403).json(response_handler_util_1.ResponseHandler.error('Operation not allowed'));
            }
            catch (error) {
                console.error('Error in deleteAllStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error deleting all students', error));
            }
        });
    }
    searchStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { searchString } = req.params;
                const students = yield this.studentUseCase.searchStudents(searchString);
                res.status(200).json(response_handler_util_1.ResponseHandler.success(students));
            }
            catch (error) {
                console.error('Error in searchStudents:', error);
                if (error.message.includes('at least')) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest(error.message));
                }
                else {
                    res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error searching students', error));
                }
            }
        });
    }
    repairStudents(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield this.studentUseCase.repairStudents();
                res.status(200).json(response_handler_util_1.ResponseHandler.success(result, 'Students repaired successfully'));
            }
            catch (error) {
                console.error('Error in repairStudents:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Error repairing students', error));
            }
        });
    }
    uploadStudentAvatar(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const studentId = req.params.id;
                // Проверка что файл загружен
                if (!req.file) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest('Fayl yüklənməyib'));
                    return;
                }
                // Формируем URL аватара
                const avatarUrl = `/uploads/students/avatars/${req.file.filename}`;
                // Обновляем студента
                const student = yield student_model_1.default.findByIdAndUpdate(studentId, { avatarUrl }, { new: true });
                if (!student) {
                    // Удаляем загруженный файл если студент не найден
                    fs_1.default.unlinkSync(req.file.path);
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound('Şagird tapılmadı'));
                    return;
                }
                res.status(200).json(response_handler_util_1.ResponseHandler.success({
                    message: 'Avatar uğurla yükləndi',
                    avatarUrl: student.avatarUrl
                }));
            }
            catch (error) {
                console.error('Error uploading student avatar:', error);
                // Удаляем файл в случае ошибки
                if (req.file) {
                    try {
                        fs_1.default.unlinkSync(req.file.path);
                    }
                    catch (unlinkError) {
                        console.error('Error deleting file:', unlinkError);
                    }
                }
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Avatar yüklənərkən xəta baş verdi', error));
            }
        });
    }
    deleteStudentAvatar(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const studentId = req.params.id;
                // Получаем студента
                const student = yield student_model_1.default.findById(studentId);
                if (!student) {
                    res.status(404).json(response_handler_util_1.ResponseHandler.notFound('Şagird tapılmadı'));
                    return;
                }
                // Если есть аватар, удаляем файл
                if (student.avatarUrl) {
                    const avatarPath = path_1.default.join(process.cwd(), student.avatarUrl);
                    if (fs_1.default.existsSync(avatarPath)) {
                        fs_1.default.unlinkSync(avatarPath);
                    }
                    // Обновляем студента
                    student.avatarUrl = undefined;
                    yield student.save();
                }
                res.status(200).json(response_handler_util_1.ResponseHandler.success({
                    message: 'Avatar uğurla silindi'
                }));
            }
            catch (error) {
                console.error('Error deleting student avatar:', error);
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Avatar silinərkən xəta baş verdi', error));
            }
        });
    }
    /**
     * Массовая загрузка аватаров студентов
     * POST /api/students/bulk-upload-avatars
     */
    bulkUploadAvatars(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const files = req.files;
                if (!files || files.length === 0) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest('Heç bir fayl yüklənməyib'));
                    return;
                }
                const uploadPath = 'uploads/students/avatars/';
                if (!fs_1.default.existsSync(uploadPath)) {
                    fs_1.default.mkdirSync(uploadPath, { recursive: true });
                }
                const results = {
                    successful: [],
                    notFound: [], // Студенты не найдены
                    corrupted: [], // Поврежденные файлы
                    total: files.length
                };
                // Обрабатываем каждый файл
                for (const file of files) {
                    try {
                        // Извлекаем код студента из имени файла (без расширения)
                        const studentCode = path_1.default.parse(file.originalname).name;
                        // Находим студента по коду
                        const student = yield student_model_1.default.findOne({ code: studentCode });
                        if (!student) {
                            results.notFound.push(studentCode);
                            // Удаляем временный файл
                            fs_1.default.unlinkSync(file.path);
                            continue;
                        }
                        // Читаем файл
                        const fileBuffer = fs_1.default.readFileSync(file.path);
                        // Применяем умный кроп с face detection
                        const croppedBuffer = yield (0, smart_crop_util_1.smartCrop)(fileBuffer, 600, 800);
                        // Сохраняем с именем по id студента
                        const filename = `${student._id}.jpg`;
                        const finalPath = path_1.default.join(uploadPath, filename);
                        // Удаляем старый файл если существует
                        if (fs_1.default.existsSync(finalPath)) {
                            fs_1.default.unlinkSync(finalPath);
                        }
                        // Сохраняем обработанный файл
                        fs_1.default.writeFileSync(finalPath, croppedBuffer);
                        // Обновляем студента
                        student.avatarUrl = `/uploads/students/avatars/${filename}`;
                        yield student.save();
                        results.successful.push(studentCode);
                        // Удаляем временный файл
                        fs_1.default.unlinkSync(file.path);
                    }
                    catch (fileError) {
                        console.error(`Error processing file ${file.originalname}:`, fileError);
                        const studentCode = path_1.default.parse(file.originalname).name;
                        results.corrupted.push(studentCode);
                        // Удаляем временный файл
                        try {
                            fs_1.default.unlinkSync(file.path);
                        }
                        catch (unlinkError) {
                            console.error('Error deleting temp file:', unlinkError);
                        }
                    }
                }
                res.status(200).json(response_handler_util_1.ResponseHandler.success({
                    message: 'Kütləvi yükləmə tamamlandı',
                    results
                }));
            }
            catch (error) {
                console.error('Error in bulk upload avatars:', error);
                // Очищаем временные файлы в случае ошибки
                if (req.files) {
                    const files = req.files;
                    files.forEach(file => {
                        try {
                            if (fs_1.default.existsSync(file.path)) {
                                fs_1.default.unlinkSync(file.path);
                            }
                        }
                        catch (unlinkError) {
                            console.error('Error deleting temp file:', unlinkError);
                        }
                    });
                }
                res.status(500).json(response_handler_util_1.ResponseHandler.internalError('Kütləvi yükləmə zamanı xəta baş verdi', error));
            }
        });
    }
}
exports.StudentController = StudentController;
// Create instance and export methods for backward compatibility
const studentController = new StudentController();
const getStudents = (req, res) => studentController.getStudents(req, res);
exports.getStudents = getStudents;
const getStudent = (req, res) => studentController.getStudent(req, res);
exports.getStudent = getStudent;
const createStudent = (req, res) => studentController.createStudent(req, res);
exports.createStudent = createStudent;
const updateStudent = (req, res) => studentController.updateStudent(req, res);
exports.updateStudent = updateStudent;
const deleteStudent = (req, res) => studentController.deleteStudent(req, res);
exports.deleteStudent = deleteStudent;
const deleteStudents = (req, res) => studentController.deleteStudents(req, res);
exports.deleteStudents = deleteStudents;
const deleteAllStudents = (req, res) => studentController.deleteAllStudents(req, res);
exports.deleteAllStudents = deleteAllStudents;
const searchStudents = (req, res) => studentController.searchStudents(req, res);
exports.searchStudents = searchStudents;
const repairStudents = (req, res) => studentController.repairStudents(req, res);
exports.repairStudents = repairStudents;
const uploadStudentAvatar = (req, res) => studentController.uploadStudentAvatar(req, res);
exports.uploadStudentAvatar = uploadStudentAvatar;
const deleteStudentAvatar = (req, res) => studentController.deleteStudentAvatar(req, res);
exports.deleteStudentAvatar = deleteStudentAvatar;
const bulkUploadAvatars = (req, res) => studentController.bulkUploadAvatars(req, res);
exports.bulkUploadAvatars = bulkUploadAvatars;
