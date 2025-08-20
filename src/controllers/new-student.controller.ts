import { Request, Response } from "express";
import { StudentUseCase } from "../usecases/student.usecase";
import { StudentService } from "../services/student.service";
import { StudentResultService } from "../services/studentResult.service";
import { RequestParser } from "../utils/request-parser.util";
import { ResponseHandler } from "../utils/response-handler.util";

export class StudentController {
    private studentUseCase: StudentUseCase;

    constructor() {
        const studentService = new StudentService();
        const studentResultService = new StudentResultService();
        this.studentUseCase = new StudentUseCase(studentService, studentResultService);
    }

    async getStudents(req: Request, res: Response): Promise<void> {
        try {
            const pagination = RequestParser.parsePagination(req);
            const filters = RequestParser.parseFilterOptions(req);
            const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

            const result = await this.studentUseCase.getStudents(pagination, filters, sort);
            res.status(200).json(ResponseHandler.success(result));
        } catch (error: any) {
            console.error('Error in getStudents:', error);
            res.status(500).json(ResponseHandler.internalError('Error fetching students', error));
        }
    }

    async getStudent(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const student = await this.studentUseCase.getStudentById(id);
            res.status(200).json(ResponseHandler.success(student));
        } catch (error: any) {
            console.error('Error in getStudent:', error);
            if (error.message === 'Student not found') {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error fetching student', error));
            }
        }
    }

    async createStudent(req: Request, res: Response): Promise<void> {
        try {
            const studentData = req.body;
            const student = await this.studentUseCase.createStudent(studentData);
            res.status(201).json(ResponseHandler.created(student, 'Student created successfully'));
        } catch (error: any) {
            console.error('Error in createStudent:', error);
            if (error.message.includes('already exists') || error.message.includes('required') || error.message.includes('must be')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error creating student', error));
            }
        }
    }

    async updateStudent(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const updateData = req.body;
            const student = await this.studentUseCase.updateStudent(id, updateData);
            res.status(200).json(ResponseHandler.updated(student, 'Student updated successfully'));
        } catch (error: any) {
            console.error('Error in updateStudent:', error);
            if (error.message === 'Student not found') {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else if (error.message.includes('already exists') || error.message.includes('ObjectId') || error.message.includes('required')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error updating student', error));
            }
        }
    }

    async deleteStudent(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.studentUseCase.deleteStudent(id);
            res.status(200).json(ResponseHandler.deleted('Student deleted successfully'));
        } catch (error: any) {
            console.error('Error in deleteStudent:', error);
            if (error.message === 'Student not found') {
                res.status(404).json(ResponseHandler.notFound(error.message));
            } else if (error.message.includes('ObjectId') || error.message.includes('required')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error deleting student', error));
            }
        }
    }

    async deleteStudents(req: Request, res: Response): Promise<void> {
        try {
            const { studentIds } = req.params;
            const ids = studentIds.split(',');
            const result = await this.studentUseCase.deleteStudents(ids);
            res.status(200).json(ResponseHandler.success(result, 'Students deleted successfully'));
        } catch (error: any) {
            console.error('Error in deleteStudents:', error);
            if (error.message.includes('must be an array') || error.message.includes('at least')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error deleting students', error));
            }
        }
    }

    async deleteAllStudents(req: Request, res: Response): Promise<void> {
        try {
            // This is a dangerous operation, should be protected with special authorization
            // For now, we'll just return an error
            res.status(403).json(ResponseHandler.error('Operation not allowed'));
        } catch (error: any) {
            console.error('Error in deleteAllStudents:', error);
            res.status(500).json(ResponseHandler.internalError('Error deleting all students', error));
        }
    }

    async searchStudents(req: Request, res: Response): Promise<void> {
        try {
            const { searchString } = req.params;
            const students = await this.studentUseCase.searchStudents(searchString);
            res.status(200).json(ResponseHandler.success(students));
        } catch (error: any) {
            console.error('Error in searchStudents:', error);
            if (error.message.includes('at least')) {
                res.status(400).json(ResponseHandler.badRequest(error.message));
            } else {
                res.status(500).json(ResponseHandler.internalError('Error searching students', error));
            }
        }
    }

    async repairStudents(req: Request, res: Response): Promise<void> {
        try {
            const result = await this.studentUseCase.repairStudents();
            res.status(200).json(ResponseHandler.success(result, 'Students repaired successfully'));
        } catch (error: any) {
            console.error('Error in repairStudents:', error);
            res.status(500).json(ResponseHandler.internalError('Error repairing students', error));
        }
    }
}

// Create instance and export methods for backward compatibility
const studentController = new StudentController();

export const getStudents = (req: Request, res: Response) => studentController.getStudents(req, res);
export const getStudent = (req: Request, res: Response) => studentController.getStudent(req, res);
export const createStudent = (req: Request, res: Response) => studentController.createStudent(req, res);
export const updateStudent = (req: Request, res: Response) => studentController.updateStudent(req, res);
export const deleteStudent = (req: Request, res: Response) => studentController.deleteStudent(req, res);
export const deleteStudents = (req: Request, res: Response) => studentController.deleteStudents(req, res);
export const deleteAllStudents = (req: Request, res: Response) => studentController.deleteAllStudents(req, res);
export const searchStudents = (req: Request, res: Response) => studentController.searchStudents(req, res);
export const repairStudents = (req: Request, res: Response) => studentController.repairStudents(req, res);
