import { DeleteResult, Types } from "mongoose";
import { IStudent, IStudentInput } from "../models/student.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";

import { deleteStudentResultsByStudentId } from "./studentResult.service";
import { buildScorePlaceMap } from "../utils/ranking.util";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";
import { CODE_DIVISORS } from "../utils/entity-codes.const";

export class StudentService {

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
                    { firstName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } },
                    { lastName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } },
                    { middleName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } },
                    { code: parseInt(searchTerms[0]) || 0 }
                ]
            };
        } else {
            // Multiple words - each word must be found in firstName, lastName, or middleName
            const nameConditions = searchTerms.map(term => ({
                $or: [
                    { firstName: { $regex: escapeRegex(term), $options: 'i' } },
                    { lastName: { $regex: escapeRegex(term), $options: 'i' } },
                    { middleName: { $regex: escapeRegex(term), $options: 'i' } }
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
        console.log('👨‍🎓 getFilteredStudents called with filters:', JSON.stringify(filters, null, 2));
        const filter = this.buildFilter(filters);
        console.log('👨‍🎓 Built MongoDB filter:', JSON.stringify(filter, null, 2));

        // Step 1: Lightweight pipeline — fetch only score for ALL filtered students.
        // No expensive $lookups. Used to:
        //   a) calculate total count
        //   b) build score→place map (same dense-rank logic as assignPlaces)
        const allScores: Array<{ score?: number }> = await Student.aggregate([
            { $match: filter },
            { $project: { score: 1 } }
        ]);

        const totalCount = allScores.length;
        console.log('👨‍🎓 Found students:', totalCount);

        if (totalCount === 0) {
            return { data: [], totalCount: 0 };
        }

        // Build score→place map from all filtered scores (dense ranking)
        const scorePlaceMap = buildScorePlaceMap(allScores);

        // Step 2: Full pipeline with all $lookups, but sort + paginate in MongoDB.
        // Only loads one page of data — no more loading all N thousand records.
        const sortDir = sort.sortDirection === 'asc' ? 1 : -1;

        const pipeline: any[] = [
            { $match: filter },

            // Lookup student results to count participations
            {
                $lookup: {
                    from: 'studentresults',
                    localField: '_id',
                    foreignField: 'student',
                    as: 'results'
                }
            },
            { $addFields: { participationCount: { $size: '$results' } } },

            // Lookup teacher
            {
                $lookup: {
                    from: 'teachers',
                    localField: 'teacher',
                    foreignField: '_id',
                    as: 'teacher'
                }
            },
            { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },

            // Lookup school
            {
                $lookup: {
                    from: 'schools',
                    localField: 'school',
                    foreignField: '_id',
                    as: 'school'
                }
            },
            { $unwind: { path: '$school', preserveNullAndEmptyArrays: true } },

            // Lookup district
            {
                $lookup: {
                    from: 'districts',
                    localField: 'district',
                    foreignField: '_id',
                    as: 'district'
                }
            },
            { $unwind: { path: '$district', preserveNullAndEmptyArrays: true } },

            // Remove raw results array (we only need the count)
            { $project: { results: 0 } },

            // Sort, then paginate — all in MongoDB
            { $sort: { [sort.sortColumn]: sortDir } },
            { $skip: pagination.skip },
            { $limit: pagination.size }
        ];

        const pageData = await Student.aggregate(pipeline).collation({ locale: 'az', strength: 2 });

        // Apply pre-computed places to this page
        pageData.forEach((student: any) => {
            student.place = scorePlaceMap.get(student.score || 0) || null;
        });

        return { data: pageData as unknown as IStudent[], totalCount };
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
                const teacherCode = Math.floor(studentCode / CODE_DIVISORS.STUDENT_TO_TEACHER);
                const schoolCode = Math.floor(studentCode / CODE_DIVISORS.STUDENT_TO_SCHOOL);
                const districtCode = Math.floor(studentCode / CODE_DIVISORS.STUDENT_TO_DISTRICT);

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

    async assignTeacherToStudent(student: IStudentInput | IStudent): Promise<void> {
        try {
            const teacherCode = Math.floor(student.code / CODE_DIVISORS.STUDENT_TO_TEACHER);
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

        // Приоритет фильтров: teacherIds > schoolIds > districtIds
        // Используем самый специфичный фильтр из доступных
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            filter.teacher = { $in: filters.teacherIds };
        } else if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        } else if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        if (filters.grades && filters.grades.length > 0) {
            filter.grade = { $in: filters.grades };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 10);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        // Поиск по имени, фамилии, отчеству или коду
        if (filters.search) {
            const searchTrim = filters.search.trim();
            
            // Check if search is a number (code search)
            if (/^\d+$/.test(searchTrim)) {
                const code = parseInt(searchTrim);
                const { start, end } = RequestParser.parseCodeRange(code, 10);
                filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
            } else {
                // Text search by name
                const searchTerms = searchTrim.split(/\s+/);
                
                if (searchTerms.length === 1) {
                    // Single word search
                    filter.$or = [
                        { firstName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } },
                        { lastName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } },
                        { middleName: { $regex: escapeRegex(searchTerms[0]), $options: 'i' } }
                    ];
                } else {
                    // Multiple words - each word must be found in firstName, lastName, or middleName
                    const nameConditions = searchTerms.map(term => ({
                        $or: [
                            { firstName: { $regex: escapeRegex(term), $options: 'i' } },
                            { lastName: { $regex: escapeRegex(term), $options: 'i' } },
                            { middleName: { $regex: escapeRegex(term), $options: 'i' } }
                        ]
                    }));
                    
                    filter.$and = nameConditions;
                }
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

export const studentService = new StudentService();

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

export async function importLegacyStudents(records: any[]): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    details: { skippedCodes: number[]; errorMessages: string[] };
}> {
    const LEGACY_YEAR = 2024;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const skippedCodes: number[] = [];
    const errorMessages: string[] = [];

    for (const record of records) {
        try {
            const code = Number(record.code);
            if (!code || isNaN(code)) {
                errors++;
                errorMessages.push(`Record skipped: missing or invalid code (${JSON.stringify(record.code)})`);
                continue;
            }

            const existing = await Student.findOne({ code });
            if (existing) {
                // Already has a 2024 rating → truly skip
                const has2024 = (existing.ratings || []).some((r: any) => r.year === LEGACY_YEAR);
                if (has2024) {
                    skipped++;
                    skippedCodes.push(code);
                    continue;
                }
                // Missing 2024 rating → add it
                const legacyScore        = typeof record.score        === 'number' ? record.score        : 0;
                const legacyAverageScore = typeof record.averageScore === 'number' ? record.averageScore : 0;
                await Student.updateOne(
                    { _id: existing._id },
                    { $push: { ratings: { year: LEGACY_YEAR, score: legacyScore, averageScore: legacyAverageScore, place: null } } }
                );
                updated++;
                continue;
            }

            // Resolve references from code structure: 1180303016
            //   district  = first 3 digits: Math.floor(code / 10_000_000)
            //   school    = first 5 digits: Math.floor(code / 100_000)
            //   teacher   = first 7 digits: Math.floor(code / 1_000)
            const districtCode = Math.floor(code / 10000000);
            const schoolCode   = Math.floor(code / 100000);
            const teacherCode  = Math.floor(code / 1000);

            let districtId: Types.ObjectId | null = null;
            let schoolId: Types.ObjectId | null = null;
            let teacherId: Types.ObjectId | null = null;

            const [districtDoc, schoolDoc, teacherDoc] = await Promise.all([
                District.findOne({ code: districtCode }),
                School.findOne({ code: schoolCode }),
                Teacher.findOne({ code: teacherCode }),
            ]);

            if (districtDoc) districtId = districtDoc._id as Types.ObjectId;
            if (schoolDoc)   schoolId   = schoolDoc._id as Types.ObjectId;
            if (teacherDoc)  teacherId  = teacherDoc._id as Types.ObjectId;

            const legacyScore        = typeof record.score        === 'number' ? record.score        : 0;
            const legacyAverageScore = typeof record.averageScore === 'number' ? record.averageScore : 0;

            await Student.create({
                code,
                firstName:  record.firstName  || '',
                lastName:   record.lastName   || '',
                middleName: record.middleName || '',
                grade:      typeof record.grade === 'number' ? record.grade : null,
                district:   districtId,
                school:     schoolId,
                teacher:    teacherId,
                ratings: [{ year: LEGACY_YEAR, score: legacyScore, averageScore: legacyAverageScore, place: null }],
                active: record.active !== undefined ? Boolean(record.active) : true,
            });
            inserted++;
        } catch (err: any) {
            errors++;
            errorMessages.push(`Student code ${record.code}: ${err.message}`);
        }
    }

    return { inserted, updated, skipped, errors, details: { skippedCodes, errorMessages } };
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