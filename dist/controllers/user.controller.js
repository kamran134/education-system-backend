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
exports.deleteUser = exports.updateUser = exports.createUser = exports.getUsers = void 0;
const user_service_1 = require("../services/user.service");
const bcrypt_1 = __importDefault(require("bcrypt"));
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, totalCount } = yield (0, user_service_1.getFilteredUsers)(req);
        res.status(200).json({ data, totalCount, message: "Users retrieved successfully" });
    }
    catch (error) {
        console.error("İstifadəçilərin alınmasında xəta:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
exports.getUsers = getUsers;
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const newUser = req.body;
        if (!newUser || typeof newUser !== 'object') {
            res.status(400).json({ message: "İstifadəçi məlumatları səhvdir" });
            return;
        }
        // Check role permissions - admin cannot create superadmin
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) === 'admin' && newUser.role === 'superadmin') {
            res.status(403).json({ message: "Admin superadmin yarada bilməz!" });
            return;
        }
        // Check if the user already exists
        const existingUser = yield (0, user_service_1.getUserByEmail)(newUser.email);
        if (existingUser) {
            res.status(400).json({ message: "İstifadəçi artıq mövcuddur" });
            return;
        }
        // Validate role-specific fields
        if (newUser.role === 'districtRepresenter' && !newUser.districtId) {
            res.status(400).json({ message: "Rayon nümayəndəsi üçün rayon seçilməlidir" });
            return;
        }
        if (newUser.role === 'schoolDirector' && !newUser.schoolId) {
            res.status(400).json({ message: "Məktəb direktoru üçün məktəb seçilməlidir" });
            return;
        }
        if (newUser.role === 'teacher' && !newUser.teacherId) {
            res.status(400).json({ message: "Müəllim üçün müəllim profili seçilməlidir" });
            return;
        }
        if (newUser.role === 'student' && !newUser.studentId) {
            res.status(400).json({ message: "Şagird üçün şagird profili seçilməlidir" });
            return;
        }
        newUser.passwordHash = yield bcrypt_1.default.hash(newUser.password, 10); // Hash the password
        // Create the user
        yield (0, user_service_1.addUser)(newUser);
        res.status(201).json({ message: "İstifadəçi uğurla yaradıldı" });
    }
    catch (error) {
        console.error("User creation error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
});
exports.createUser = createUser;
const updateUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const updateData = req.body;
        const id = updateData._id;
        const updateRole = updateData.role;
        if (!updateData || typeof updateData !== 'object') {
            res.status(400).json({ message: "Məlumatlar yalnışdır" });
            return;
        }
        if (!id) {
            res.status(400).json({ message: "ID mütləqdir" });
            return;
        }
        // Check if the user exists
        const existingUser = yield (0, user_service_1.getUserById)(id);
        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }
        // Update the user
        if (existingUser.role === "superadmin") {
            res.status(403).json({ message: "Superadmini digər istifadəçi redaktə edə bilməz!" });
            return;
        }
        if (updateRole === "superadmin" && ((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== "superadmin") {
            res.status(403).json({ message: "Superadmin bu üsulla təyin edilə bilməz! Texniki dəstəyə müraciət edin!" });
            return;
        }
        // Validate role-specific fields when changing role
        if (updateRole === 'districtRepresenter' && !updateData.districtId) {
            res.status(400).json({ message: "Rayon nümayəndəsi üçün rayon seçilməlidir" });
            return;
        }
        if (updateRole === 'schoolDirector' && !updateData.schoolId) {
            res.status(400).json({ message: "Məktəb direktoru üçün məktəb seçilməlidir" });
            return;
        }
        if (updateRole === 'teacher' && !updateData.teacherId) {
            res.status(400).json({ message: "Müəllim üçün müəllim profili seçilməlidir" });
            return;
        }
        if (updateRole === 'student' && !updateData.studentId) {
            res.status(400).json({ message: "Şagird üçün şagird profili seçilməlidir" });
            return;
        }
        yield (0, user_service_1.editUser)(id, updateData);
        res.status(200).json({ message: "İstifadəçi məlumatları yeniləndi!" });
    }
    catch (error) {
        console.error("User update error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
});
exports.updateUser = updateUser;
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ message: "ID mütləqdir" });
            return;
        }
        // Check if the user exists
        const existingUser = yield (0, user_service_1.getUserById)(id);
        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }
        if (existingUser.role === "superadmin") {
            res.status(403).json({ message: "Superadmini silmək olmaz!" });
            return;
        }
        // Delete the user
        yield (0, user_service_1.removeUser)(id);
        res.status(200).json({ message: "İstifadəçi uğurla silindi" });
    }
    catch (error) {
        console.error("User deletion error:", error);
        res.status(500).json({ message: `Server xətası. ${error}` });
    }
});
exports.deleteUser = deleteUser;
