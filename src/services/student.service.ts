import { DeleteResult, Types } from "mongoose";
import { IStudent, IStudentInput } from "../models/student.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { Request } from "express";
import { deleteStudentResultsByStudentId } from "./studentResult.service";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";

export class StudentService {
    // Функция для расчета мест с учетом одинаковых баллов
    private assignPlaces<T extends { averageScore?: number; score?: number; place?: number | null }>(
        items: T[],
        scoreField: 'averageScore' | 'score' = 'averageScore'
    ): T[] {
        if (items.length === 0) return items;

        // Сортируем по убыванию (высокий балл = лучшее место)
        items.sort((a, b) => {
            const scoreA = a[scoreField] || 0;
            const scoreB = b[scoreField] || 0;
            return scoreB - scoreA;
        });

        let currentPlace = 1;
        let previousScore: number | null = null;

        items.forEach((item, index) => {
            const currentScore = item[scoreField] || 0;

            if (index === 0) {
                // Первый элемент всегда место 1
                item.place = 1;
                previousScore = currentScore;
            } else if (currentScore < previousScore!) {
                // Балл меньше предыдущего - новое место
                currentPlace++;
                item.place = currentPlace;
                previousScore = currentScore;
            } else {
                // Балл такой же - то же место
                item.place = currentPlace;
            }
        });

        return items;
    }

    async findById(id: string): Promise<IStudent | null> {
        return await Student.findById(id).populate('district school teacher');
    }

    async findByCode(code: number): Promise<IStudent | null> {
        return await Student.findOne({ code });
    }

    async create(studentData: IStudentInput): Promise<IStudent> {
        await this.assignTeacherToStudent(studentData);
        const student = new Student(studentData);
        return await student.save();
    }

    async update(id: string, updateData: Partial<IStudentInput>): Promise<IStudent> {
        const updatedStudent = await Student.findByIdAndUpdate(
            id, 
            updateData, 
            { new: true, runValidators: true }
        ).populate('district school teacher');
        
        if (!updatedStudent) {
            throw new Error('Student not found');
        }

        return updatedStudent;
    }

    async delete(id: string): Promise<void> {
        const result = await Student.findByIdAndDelete(id);
        if (!result) {
            throw new Error('Student not found');
        }
    }

    async deleteBulk(ids: Types.ObjectId[]): Promise<BulkOperationResult> {
        const result = await Student.deleteMany({ _id: { $in: ids } });
        return {
            insertedCount: 0,
            modifiedCount: 0,
            deletedCount: result.deletedCount || 0,
            errors: []
        };
    }

    async search(searchString: string): Promise<IStudent[]> {
        const searchTerms = searchString.trim().split(/\s+/);
        let matchCondition: any;
        
        if (searchTerms.length === 1) {
            // Single word search
            matchCondition = {
                $or: [
                    { firstName: { $regex: searchTerms[0], $options: 'i' } },
                    { lastName: { $regex: searchTerms[0], $options: 'i' } },
                    { middleName: { $regex: searchTerms[0], $options: 'i' } },
                    { code: parseInt(searchTerms[0]) || 0 }
                ]
            };
        } else {
            // Multiple words - each word must be found in firstName, lastName, or middleName
            const nameConditions = searchTerms.map(term => ({
                $or: [
                    { firstName: { $regex: term, $options: 'i' } },
                    { lastName: { $regex: term, $options: 'i' } },
                    { middleName: { $regex: term, $options: 'i' } }
                ]
            }));
            
            matchCondition = {
                $and: nameConditions
            };
        }
        
        return await Student.aggregate([
            {
                $match: matchCondition
            },
            {
                $lookup: {
                    from: 'teachers',
                    localField: 'teacher',
                    foreignField: '_id',
                    as: 'teacher'
                }
            },
            {
                $unwind: {
                    path: '$teacher',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'schools',
                    localField: 'school',
                    foreignField: '_id',
                    as: 'school'
                }
            },
            {
                $unwind: {
                    path: '$school',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'districts',
                    localField: 'district',
                    foreignField: '_id',
                    as: 'district'
                }
            },
            {
                $unwind: {
                    path: '$district',
                    preserveNullAndEmptyArrays: true
                }
            }
        ]);
    }

    async getFilteredStudents(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IStudent[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        // Получаем ВСЕ отфильтрованные данные для расчета мест
        const allData = await Student.find(filter)
            .collation({ locale: 'az', strength: 2 })
            .populate('district school teacher')
            .sort(sortOptions)
            .lean();

        // Расчитываем места на ВСЕХ данных
        // Для студентов используем score (общий балл), а не averageScore
        this.assignPlaces(allData, 'score');

        // Применяем пагинацию ПОСЛЕ расчета мест
        const paginatedData = allData.slice(pagination.skip, pagination.skip + pagination.size);

        const totalCount = await Student.countDocuments(filter);

        return { data: paginatedData as IStudent[], totalCount };
    }

    async repairStudentAssignments(): Promise<{ 
        repairedStudents: number[], 
        failedStudents: Array<{ code: number, reason: string }>,
        missedDistricts: number[],
        missedSchools: number[],
        missedTeachers: number[]
    }> {
        // Find students with missing teacher, school, or district
        const students = await Student.find({
            $or: [
                { teacher: { $exists: false } },
                { teacher: null },
                { school: { $exists: false } },
                { school: null },
                { district: { $exists: false } },
                { district: null }
            ]
        });

        console.log(`Found ${students.length} students with missing assignments`);

        const repairedStudents: number[] = [];
        const failedStudents: Array<{ code: number, reason: string }> = [];
        const missedDistricts: number[] = [];
        const missedSchools: number[] = [];
        const missedTeachers: number[] = [];

        // Pre-fetch all teachers, schools, and districts
        const allTeachers = await Teacher.find({});
        const allSchools = await School.find({});
        const allDistricts = await District.find({});

        // Create maps for quick lookup by CODE
        const teacherMap = new Map(allTeachers.map(t => [t.code, t]));
        const schoolMap = new Map(allSchools.map(s => [s.code, s]));
        const districtMap = new Map(allDistricts.map(d => [d.code, d]));

        for (const student of students) {
            try {
                const studentCode = student.code;
                let hasChanges = false;
                
                // Extract codes from student code
                const teacherCode = Math.floor(studentCode / 1000); // 1500188
                const schoolCode = Math.floor(studentCode / 100000); // 15001
                const districtCode = Math.floor(studentCode / 10000000); // 150

                console.log(`Processing student ${studentCode}: teacher=${teacherCode}, school=${schoolCode}, district=${districtCode}`);

                // Assign teacher if missing
                if (!(student as any).teacher) {
                    const teacher = teacherMap.get(teacherCode);
                    if (teacher) {
                        (student as any).teacher = teacher._id;
                        hasChanges = true;
                        console.log(`  ✓ Assigned teacher ${teacherCode}`);
                    } else {
                        console.log(`  ✗ Teacher ${teacherCode} not found`);
                        missedTeachers.push(studentCode);
                    }
                }

                // Assign school if missing
                if (!(student as any).school) {
                    const school = schoolMap.get(schoolCode);
                    if (school) {
                        (student as any).school = school._id;
                        hasChanges = true;
                        console.log(`  ✓ Assigned school ${schoolCode}`);
                    } else {
                        console.log(`  ✗ School ${schoolCode} not found`);
                        missedSchools.push(studentCode);
                    }
                }

                // Assign district if missing
                if (!(student as any).district) {
                    const district = districtMap.get(districtCode);
                    if (district) {
                        (student as any).district = district._id;
                        hasChanges = true;
                        console.log(`  ✓ Assigned district ${districtCode}`);
                    } else {
                        console.log(`  ✗ District ${districtCode} not found`);
                        missedDistricts.push(studentCode);
                    }
                }

                // Save if there were changes
                if (hasChanges) {
                    await student.save();
                    repairedStudents.push(studentCode);
                    console.log(`✓ Saved student ${studentCode}`);
                }

            } catch (error) {
                console.error(`Error processing student ${student.code}:`, error);
                failedStudents.push({ 
                    code: student.code, 
                    reason: `Error: ${error instanceof Error ? error.message : 'Unknown'}` 
                });
            }
        }

        console.log(`Repair complete: ${repairedStudents.length} repaired`);
        console.log(`  Missed teachers: ${missedTeachers.length}`);
        console.log(`  Missed schools: ${missedSchools.length}`);
        console.log(`  Missed districts: ${missedDistricts.length}`);
        
        return { 
            repairedStudents, 
            failedStudents,
            missedDistricts,
            missedSchools,
            missedTeachers
        };
    }

    private async assignTeacherToStudent(student: IStudentInput | IStudent): Promise<void> {
        try {
            const teacherCode = Math.floor(student.code / 1000);
            const teacher: ITeacher | null = await Teacher.findOne({ code: teacherCode });
            
            if (teacher) {
                student.teacher = teacher._id as Types.ObjectId;
                
                const studentSchool = await School.findById(teacher.school);
                if (studentSchool) {
                    student.school = studentSchool._id as Types.ObjectId;
                    
                    const studentDistrict = await District.findById(studentSchool.district);
                    if (studentDistrict) {
                        student.district = studentDistrict._id as Types.ObjectId;
                    }
                }
            }
        } catch (error) {
            console.error(`Error assigning teacher to student ${student.code}:`, error);
        }
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

        if (filters.districtIds && filters.districtIds.length > 0 && (!filters.schoolIds || filters.schoolIds.length === 0)) {
            filter.district = { $in: filters.districtIds };
        }
        
        if (filters.schoolIds && filters.schoolIds.length > 0 && (!filters.teacherIds || filters.teacherIds.length === 0)) {
            filter.school = { $in: filters.schoolIds };
        }
        
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            filter.teacher = { $in: filters.teacherIds };
        }

        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        // Поиск по имени, фамилии или отчеству
        if (filters.search) {
            const searchTerms = filters.search.trim().split(/\s+/);
            
            if (searchTerms.length === 1) {
                // Single word search
                filter.$or = [
                    { firstName: { $regex: searchTerms[0], $options: 'i' } },
                    { lastName: { $regex: searchTerms[0], $options: 'i' } },
                    { middleName: { $regex: searchTerms[0], $options: 'i' } }
                ];
            } else {
                // Multiple words - each word must be found in firstName, lastName, or middleName
                const nameConditions = searchTerms.map(term => ({
                    $or: [
                        { firstName: { $regex: term, $options: 'i' } },
                        { lastName: { $regex: term, $options: 'i' } },
                        { middleName: { $regex: term, $options: 'i' } }
                    ]
                }));
                
                filter.$and = nameConditions;
            }
        }

        return filter;
    }

    buildExamFilter(filters: FilterOptions, studentIds: Types.ObjectId[]): any {
        const filter: any = {
            _id: { $in: studentIds }
        };

        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        return filter;
    }
}

// Legacy functions for backward compatibility
export const assignTeacherToStudent = async (student: IStudentInput) => {
    const service = new StudentService();
    await (service as any).assignTeacherToStudent(student);
}

export const getFiltredStudents = async (req: Request): Promise<{ data: IStudent[], totalCount: number }> => {
    const service = new StudentService();
    const pagination = RequestParser.parsePagination(req);
    const filters = RequestParser.parseFilterOptions(req);
    const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

    // Handle defective filter
    const defective = req.query.defective?.toString().toLowerCase() === 'true';
    if (defective) {
        const filter = {
            $or: [
                { teacher: null },
                { school: null },
                { district: null },
            ]
        };
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            Student.find(filter)
                .populate('district school teacher')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            Student.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    // Handle exam filter specially
    if (filters.examIds && filters.examIds.length > 0) {
        console.log('🔥 Filtering students by examIds:', filters.examIds);
        const studentsInExam = await StudentResult.find({ exam: { $in: filters.examIds } }).distinct('student');
        console.log('🔥 Students found in exam:', studentsInExam.length);
        console.log('🔥 Student IDs:', studentsInExam);
        
        filters.districtIds = undefined;
        filters.schoolIds = undefined;
        filters.teacherIds = undefined;
        const customFilter = service.buildExamFilter(filters, studentsInExam);
        
        console.log('🔍 Custom filter for exam students:', JSON.stringify(customFilter));
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            Student.find(customFilter)
                .populate('district school teacher')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            Student.countDocuments(customFilter)
        ]);

        console.log('✅ Filtered students count:', totalCount);
        return { data, totalCount };
    }

    return await service.getFilteredStudents(pagination, filters, sort);
}

export const deleteStudentById = async (id: string) => {
    try {
        Promise.all([
            deleteStudentResultsByStudentId(id),
            Student.findByIdAndDelete(id)
        ]);
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByIds = async (studentIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const [result, studentResults] = await Promise.all([
            Student.deleteMany({ _id: { $in: studentIds } }),
            StudentResult.deleteMany({ student: { $in: studentIds } })
        ]);

        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByTeacherId = async (teacherId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const studentIds = await Student.find({ teacher: teacherId }).distinct('_id');

        const [result, studentResults] = await Promise.all([
            Student.deleteMany({ teacher: teacherId }),
            StudentResult.deleteMany({ student: { $in: studentIds } })
        ]);
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByTeachersIds = async (teacherIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ teacher: { $in: teacherIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ teacher: { $in: teacherIds } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsBySchoolId = async (schoolId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ school: schoolId });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ school: { $in: schoolId } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsBySchoolsIds = async (schoolIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ school: { $in: schoolIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ school: { $in: schoolIds } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByDistrictId = async (districtId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ district: districtId });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ district: { $in: districtId } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}