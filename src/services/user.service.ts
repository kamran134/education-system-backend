import { DeleteResult, FilterQuery, Types } from "mongoose";
import bcrypt from "bcrypt";
import User, { IUser, IUserCreate, UserRole } from "../models/user.model";

import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult } from "../types/common.types";


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
        
        const sortOptions: Record<string, 1 | -1> = {};
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
        const user = await User.findById(id);
        if (!user) {
            throw new Error('User not found');
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(id, { passwordHash: hashedPassword });
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

    private buildFilter(filters: FilterOptions): FilterQuery<IUser> {
        const filter: FilterQuery<IUser> = {};

        if (filters.active !== undefined) {
            filter.isApproved = filters.active;
        }

        return filter;
    }
}

export const userService = new UserService();
