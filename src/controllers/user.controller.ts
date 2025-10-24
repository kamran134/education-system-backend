import { Request, Response } from 'express';
import { addUser, editUser, getFilteredUsers, getUserByEmail, getUserById, removeUser } from '../services/user.service';
import bcrypt from "bcrypt";

export const getUsers = async (req: Request, res: Response) => {
    try {
        const { data, totalCount } = await getFilteredUsers(req);
        res.status(200).json({ data, totalCount, message: "Users retrieved successfully" });
    }
    catch (error) {
        console.error("İstifadəçilərin alınmasında xəta:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export const createUser = async (req: Request, res: Response) => {
    try {
        const newUser = req.body;

        if (!newUser || typeof newUser !== 'object') {
            res.status(400).json({ message: "İstifadəçi məlumatları səhvdir" });
            return;
        }

        // Check role permissions - admin cannot create superadmin
        if (req.user?.role === 'admin' && newUser.role === 'superadmin') {
            res.status(403).json({ message: "Admin superadmin yarada bilməz!" });
            return;
        }

        // Check if the user already exists
        const existingUser = await getUserByEmail(newUser.email);

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

        newUser.passwordHash = await bcrypt.hash(newUser.password, 10); // Hash the password

        // Create the user
        await addUser(newUser);
        
        res.status(201).json({ message: "İstifadəçi uğurla yaradıldı" });
    } catch (error) {
        console.error("User creation error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
}

export const updateUser = async (req: Request, res: Response) => {
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
        const existingUser = await getUserById(id);

        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }
        // Update the user
        if (existingUser.role === "superadmin") {
            res.status(403).json({ message: "Superadmini digər istifadəçi redaktə edə bilməz!" });
            return;
        }

        if (updateRole === "superadmin" && req.user?.role !== "superadmin") {
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

        await editUser(id, updateData);
        
        res.status(200).json({ message: "İstifadəçi məlumatları yeniləndi!" });
    } catch (error) {
        console.error("User update error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
}

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!id) {
            res.status(400).json({ message: "ID mütləqdir" });
            return;
        }

        // Check if the user exists
        const existingUser = await getUserById(id);

        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }

        if (existingUser.role === "superadmin") {
            res.status(403).json({ message: "Superadmini silmək olmaz!" });
            return;
        }

        // Delete the user
        await removeUser(id);
        
        res.status(200).json({ message: "İstifadəçi uğurla silindi" });
    } catch (error) {
        console.error("User deletion error:", error);
        res.status(500).json({ message: `Server xətası. ${error}` });
    }
}