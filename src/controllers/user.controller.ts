import { Request, Response } from 'express';
import { userServicePg } from '../services/user.service.pg';
import { RequestParser } from '../utils/request-parser.util';
import bcrypt from "bcrypt";

export const getUsers = async (req: Request, res: Response) => {
    try {
        const pagination = RequestParser.parsePagination(req);
        const filters = RequestParser.parseFilterOptionsPg(req);
        const sort = RequestParser.parseSorting(req, 'email', 'asc');
        const { data, totalCount } = await userServicePg.getFilteredUsers(pagination, filters, sort);
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
        const existingUser = await userServicePg.findByEmail(newUser.email);

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

        const passwordHash = await bcrypt.hash(newUser.password, 10); // Hash the password

        // Create the user
        await userServicePg.create({
            email: newUser.email,
            passwordHash,
            role: newUser.role,
            isApproved: newUser.isApproved,
            districtId: newUser.districtId ? parseInt(newUser.districtId, 10) : undefined,
            schoolId: newUser.schoolId ? parseInt(newUser.schoolId, 10) : undefined,
            teacherId: newUser.teacherId ? parseInt(newUser.teacherId, 10) : undefined,
            studentId: newUser.studentId ? parseInt(newUser.studentId, 10) : undefined,
        });

        res.status(201).json({ message: "İstifadəçi uğurla yaradıldı" });
    } catch (error) {
        console.error("User creation error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
}

export const updateUser = async (req: Request, res: Response) => {
    try {
        const updateData = req.body;
        // Mongo-версия читала _id (тело формы шло 1:1 из документа); Postgres-эпоха — числовой id,
        // фронт может присылать либо id, либо всё ещё _id (переходный период) — принимаем оба.
        const id = updateData.id ?? updateData._id;
        const updateRole = updateData.role;

        if (!updateData || typeof updateData !== 'object') {
            res.status(400).json({ message: "Məlumatlar yalnışdır" });
            return;
        }

        if (!id) {
            res.status(400).json({ message: "ID mütləqdir" });
            return;
        }

        const numericId = parseInt(id, 10);

        // Check if the user exists
        const existingUser = await userServicePg.findById(numericId);

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

        await userServicePg.update(numericId, {
            email: updateData.email,
            role: updateData.role,
            isApproved: updateData.isApproved,
            districtId: updateData.districtId !== undefined ? (updateData.districtId ? parseInt(updateData.districtId, 10) : null) : undefined,
            schoolId: updateData.schoolId !== undefined ? (updateData.schoolId ? parseInt(updateData.schoolId, 10) : null) : undefined,
            teacherId: updateData.teacherId !== undefined ? (updateData.teacherId ? parseInt(updateData.teacherId, 10) : null) : undefined,
            studentId: updateData.studentId !== undefined ? (updateData.studentId ? parseInt(updateData.studentId, 10) : null) : undefined,
        });

        res.status(200).json({ message: "İstifadəçi məlumatları yeniləndi!" });
    } catch (error) {
        console.error("User update error:", error);
        res.status(500).json({ message: "Server xətası" });
    }
}

export const changePassword = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
            res.status(400).json({ message: "Yeni şifrə ən az 6 simvol olmalıdır" });
            return;
        }

        const numericId = parseInt(id, 10);
        const existingUser = await userServicePg.findById(numericId);
        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }

        await userServicePg.changePassword(numericId, newPassword);
        res.status(200).json({ message: "Şifrə uğurla yeniləndi" });
    } catch (error) {
        console.error("Password change error:", error);
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

        const numericId = parseInt(id, 10);

        // Check if the user exists
        const existingUser = await userServicePg.findById(numericId);

        if (!existingUser) {
            res.status(404).json({ message: "İstifadəçi tapılmadı" });
            return;
        }

        if (existingUser.role === "superadmin") {
            res.status(403).json({ message: "Superadmini silmək olmaz!" });
            return;
        }

        // Delete the user
        await userServicePg.delete(numericId);

        res.status(200).json({ message: "İstifadəçi uğurla silindi" });
    } catch (error) {
        console.error("User deletion error:", error);
        res.status(500).json({ message: `Server xətası. ${error}` });
    }
}
