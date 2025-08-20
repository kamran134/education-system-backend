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
exports.removeUser = exports.editUser = exports.addUser = exports.getUserByEmail = exports.getUserById = exports.getFilteredUsers = void 0;
const user_model_1 = __importDefault(require("../models/user.model"));
const getFilteredUsers = (req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const filter = {};
        if (req.query.role) {
            filter.role = req.query.role;
        }
        if (req.query.isApproved) {
            filter.isApproved = req.query.isApproved === 'true';
        }
        const totalCount = yield user_model_1.default.countDocuments(filter);
        const data = yield user_model_1.default.find(filter)
            .sort({ createdAt: -1 });
        return { data, totalCount };
    }
    catch (error) {
        console.error("Error fetching users:", error);
        throw new Error("Failed to fetch users");
    }
});
exports.getFilteredUsers = getFilteredUsers;
const getUserById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield user_model_1.default.findById(id);
        if (!user) {
            throw new Error("İstifadəçi tapılmadı");
        }
        return user;
    }
    catch (error) {
        console.error("Error fetching user by ID:", error);
        throw new Error("Failed to fetch user");
    }
});
exports.getUserById = getUserById;
const getUserByEmail = (email) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield user_model_1.default.findOne({ email });
        return user;
    }
    catch (error) {
        console.error("Error fetching user by email:", error);
        throw new Error("Failed to fetch user");
    }
});
exports.getUserByEmail = getUserByEmail;
const addUser = (userData) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const existingUser = yield user_model_1.default.findOne({ email: userData.email });
        if (existingUser) {
            throw new Error("İstifadəçi artıq mövcuddur");
        }
        const newUser = new user_model_1.default(userData);
        const createdUser = yield user_model_1.default.create(newUser);
        return createdUser;
    }
    catch (error) {
        console.error("User creation error:", error);
        throw new Error("Failed to create user");
    }
});
exports.addUser = addUser;
const editUser = (id, updateData) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const updatedUser = yield user_model_1.default.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedUser) {
            throw new Error("User not found");
        }
        return updatedUser;
    }
    catch (error) {
        console.error("User update error:", error);
        throw new Error("Failed to update user");
    }
});
exports.editUser = editUser;
const removeUser = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const deletedUser = yield user_model_1.default.findByIdAndDelete(id);
        if (!deletedUser) {
            throw new Error("İstifadəçi tapılmadı");
        }
        if (deletedUser.role === 'superadmin') {
            throw new Error("Superadmin istifadəçiləri silinə bilməz");
        }
        return deletedUser;
    }
    catch (error) {
        console.error("User deletion error:", error);
        throw new Error("Silinmə zamanı xəta baş verdi");
    }
});
exports.removeUser = removeUser;
