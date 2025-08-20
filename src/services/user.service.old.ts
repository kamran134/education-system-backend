import { Request } from 'express';
import User, { IUser } from '../models/user.model';

export const getFilteredUsers = async (req: Request): Promise<{ data: IUser[], totalCount: number }> => {
    try {
        const filter: any = {};
        if (req.query.role) {
            filter.role = req.query.role;
        }
        if (req.query.isApproved) {
            filter.isApproved = req.query.isApproved === 'true';
        }

        const totalCount: number = await User.countDocuments(filter);
        const data: IUser[] = await User.find(filter)
            .sort({ createdAt: -1 });

        return { data, totalCount };
    } catch (error) {
        console.error("Error fetching users:", error);
        throw new Error("Failed to fetch users");
    }
}

export const getUserById = async (id: string): Promise<IUser | null> => {
    try {
        const user: IUser | null = await User.findById(id);
        if (!user) {
            throw new Error("İstifadəçi tapılmadı");
        }
        return user;
    } catch (error) {
        console.error("Error fetching user by ID:", error);
        throw new Error("Failed to fetch user");
    }
}

export const getUserByEmail = async (email: string): Promise<IUser | null> => {
    try {
        const user: IUser | null = await User.findOne({ email });
        return user;
    } catch (error) {
        console.error("Error fetching user by email:", error);
        throw new Error("Failed to fetch user");
    }
}

export const addUser = async (userData: IUser): Promise<IUser> => {
    try {
        const existingUser: IUser | null = await User.findOne({ email: userData.email });
        if (existingUser) {
            throw new Error("İstifadəçi artıq mövcuddur");
        }
        const newUser: IUser = new User(userData);
        
        const createdUser = await User.create(newUser);

        return createdUser;
    } catch (error) {
        console.error("User creation error:", error);
        throw new Error("Failed to create user");
    }
}

export const editUser = async (id: string, updateData: Partial<IUser>): Promise<IUser | null> => {
    try {
        const updatedUser: IUser | null = await User.findByIdAndUpdate(id, updateData, { new: true });
        if (!updatedUser) {
            throw new Error("User not found");
        }
        return updatedUser;
    } catch (error) {
        console.error("User update error:", error);
        throw new Error("Failed to update user");
    }
}

export const removeUser = async (id: string): Promise<IUser | null> => {
    try {
        const deletedUser: IUser | null = await User.findByIdAndDelete(id);
        if (!deletedUser) {
            throw new Error("İstifadəçi tapılmadı");
        }
        if (deletedUser.role === 'superadmin') {
            throw new Error("Superadmin istifadəçiləri silinə bilməz");
        }
        return deletedUser;
    } catch (error) {
        console.error("User deletion error:", error);
        throw new Error("Silinmə zamanı xəta baş verdi");
    }
}