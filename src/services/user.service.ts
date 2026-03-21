import { DeleteResult, Types } from "mongoose";
import User, { IUser, IUserCreate, UserRole } from "../models/user.model";
import { Request } from "express";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";

export class UserService {
    async findById(id: string): Promise<IUser | null> {
        return await User.findById(id);
    }

    async findByEmail(email: string): Promise<IUser | null> {
        return await User.findOne({ email });
    }

    async create(userData: IUserCreate): Promise<IUser> {
        const user = new User(userData);
        return await user.save();
    }

    async update(id: string, updateData: Partial<IUserCreate>): Promise<IUser> {
        const updatedUser = await User.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            throw new Error('User not found');
        }

        return updatedUser;
    }

    async delete(id: string): Promise<void> {
        const result = await User.findByIdAndDelete(id);
        if (!result) {
            throw new Error('User not found');
        }
    }

    async deleteBulk(ids: Types.ObjectId[]): Promise<BulkOperationResult> {
        const result = await User.deleteMany({ _id: { $in: ids } });

        return {
            insertedCount: 0,
            modifiedCount: 0,
            deletedCount: result.deletedCount || 0,
            errors: []
        };
    }

    async getFilteredUsers(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IUser[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            User.find(filter)
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            User.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async approveUser(id: string): Promise<IUser> {
        const user = await User.findByIdAndUpdate(
            id,
            { isApproved: true },
            { new: true }
        );

        if (!user) {
            throw new Error('User not found');
        }

        return user;
    }

    async changePassword(id: string, newPassword: string): Promise<void> {
        // TODO: Implement password hashing
        // const hashedPassword = await bcrypt.hash(newPassword, 10);
        // await User.findByIdAndUpdate(id, { passwordHash: hashedPassword });
        throw new Error('Password change not implemented yet');
    }

    async changeRole(id: string, role: UserRole): Promise<IUser> {
        const user = await User.findByIdAndUpdate(
            id,
            { role },
            { new: true }
        );

        if (!user) {
            throw new Error('User not found');
        }

        return user;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

        if (filters.active !== undefined) {
            filter.isApproved = filters.active;
        }

        return filter;
    }
}

// Legacy functions for backward compatibility
const userService = new UserService();

export const getFilteredUsers = async (req: Request): Promise<{ data: IUser[], totalCount: number }> => {
    const pagination = RequestParser.parsePagination(req);
    const filters = RequestParser.parseFilterOptions(req);
    const sort = RequestParser.parseSorting(req, 'email', 'asc');

    return await userService.getFilteredUsers(pagination, filters, sort);
}

export const getUserById = async (id: string): Promise<IUser | null> => {
    return await userService.findById(id);
}

export const getUserByEmail = async (email: string): Promise<IUser | null> => {
    return await userService.findByEmail(email);
}

export const addUser = async (userData: IUserCreate): Promise<IUser> => {
    return await userService.create(userData);
}

export const editUser = async (id: string, updateData: Partial<IUserCreate>): Promise<IUser | null> => {
    return await userService.update(id, updateData);
}

export const removeUser = async (id: string): Promise<IUser | null> => {
    const user = await userService.findById(id);
    if (user) {
        await userService.delete(id);
        return user;
    }
    return null;
}
