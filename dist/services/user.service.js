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
exports.removeUser = exports.editUser = exports.addUser = exports.getUserByEmail = exports.getUserById = exports.getFilteredUsers = exports.UserService = void 0;
const user_model_1 = __importDefault(require("../models/user.model"));
const request_parser_util_1 = require("../utils/request-parser.util");
class UserService {
    findById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield user_model_1.default.findById(id);
        });
    }
    findByEmail(email) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield user_model_1.default.findOne({ email });
        });
    }
    create(userData) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = new user_model_1.default(userData);
            return yield user.save();
        });
    }
    update(id, updateData) {
        return __awaiter(this, void 0, void 0, function* () {
            const updatedUser = yield user_model_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
            if (!updatedUser) {
                throw new Error('User not found');
            }
            return updatedUser;
        });
    }
    delete(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield user_model_1.default.findByIdAndDelete(id);
            if (!result) {
                throw new Error('User not found');
            }
        });
    }
    deleteBulk(ids) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield user_model_1.default.deleteMany({ _id: { $in: ids } });
            return {
                insertedCount: 0,
                modifiedCount: 0,
                deletedCount: result.deletedCount || 0,
                errors: []
            };
        });
    }
    getFilteredUsers(pagination, filters, sort) {
        return __awaiter(this, void 0, void 0, function* () {
            const filter = this.buildFilter(filters);
            const sortOptions = {};
            sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;
            const [data, totalCount] = yield Promise.all([
                user_model_1.default.find(filter)
                    .sort(sortOptions)
                    .skip(pagination.skip)
                    .limit(pagination.size),
                user_model_1.default.countDocuments(filter)
            ]);
            return { data, totalCount };
        });
    }
    approveUser(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield user_model_1.default.findByIdAndUpdate(id, { isApproved: true }, { new: true });
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        });
    }
    changePassword(id, newPassword) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Implement password hashing
            // const hashedPassword = await bcrypt.hash(newPassword, 10);
            // await User.findByIdAndUpdate(id, { passwordHash: hashedPassword });
            throw new Error('Password change not implemented yet');
        });
    }
    changeRole(id, role) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield user_model_1.default.findByIdAndUpdate(id, { role }, { new: true });
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        });
    }
    buildFilter(filters) {
        const filter = {};
        if (filters.active !== undefined) {
            filter.isApproved = filters.active;
        }
        return filter;
    }
}
exports.UserService = UserService;
// Legacy functions for backward compatibility
const userService = new UserService();
const getFilteredUsers = (req) => __awaiter(void 0, void 0, void 0, function* () {
    const pagination = request_parser_util_1.RequestParser.parsePagination(req);
    const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
    const sort = request_parser_util_1.RequestParser.parseSorting(req, 'email', 'asc');
    return yield userService.getFilteredUsers(pagination, filters, sort);
});
exports.getFilteredUsers = getFilteredUsers;
const getUserById = (id) => __awaiter(void 0, void 0, void 0, function* () {
    return yield userService.findById(id);
});
exports.getUserById = getUserById;
const getUserByEmail = (email) => __awaiter(void 0, void 0, void 0, function* () {
    return yield userService.findByEmail(email);
});
exports.getUserByEmail = getUserByEmail;
const addUser = (userData) => __awaiter(void 0, void 0, void 0, function* () {
    return yield userService.create(userData);
});
exports.addUser = addUser;
const editUser = (id, updateData) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        return yield userService.update(id, updateData);
    }
    catch (error) {
        return null;
    }
});
exports.editUser = editUser;
const removeUser = (id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield userService.findById(id);
        if (user) {
            yield userService.delete(id);
            return user;
        }
        return null;
    }
    catch (error) {
        return null;
    }
});
exports.removeUser = removeUser;
