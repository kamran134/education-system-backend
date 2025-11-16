import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { Types } from "mongoose";

export interface ExamResultsFilter {
    search?: string;
    code?: number;
    dateFrom?: string;
    dateTo?: string;
    examIds?: string[];
    districtIds?: string[];
    schoolIds?: string[];
    teacherIds?: string[];
}

export class ExamResultsService {
    
    async getExamResults(
        filters: ExamResultsFilter,
        sortColumn: string = 'exam.date',
        sortDirection: string = 'desc',
        page: number = 1,
        size: number = 25
    ): Promise<{ data: IStudentResult[], totalCount: number }> {
        
        console.log('🎯 ExamResults Service - Filters:', filters);
        
        const pipeline: any[] = [];

        // Match stage
        const matchConditions: any = {};

        // Date filters
        if (filters.dateFrom || filters.dateTo) {
            const examPipeline: any[] = [
                {
                    $lookup: {
                        from: 'exams',
                        localField: 'exam',
                        foreignField: '_id',
                        as: 'examInfo'
                    }
                }
            ];

            if (filters.dateFrom || filters.dateTo) {
                const dateFilter: any = {};
                if (filters.dateFrom) {
                    dateFilter.$gte = new Date(filters.dateFrom);
                }
                if (filters.dateTo) {
                    dateFilter.$lte = new Date(filters.dateTo);
                }
                examPipeline.push({
                    $match: {
                        'examInfo.date': dateFilter
                    }
                });
            }

            pipeline.push(...examPipeline);
        }

        // Lookup student data with nested lookups
        pipeline.push({
            $lookup: {
                from: 'students',
                localField: 'student',
                foreignField: '_id',
                as: 'studentData',
                pipeline: [
                    {
                        $lookup: {
                            from: 'teachers',
                            localField: 'teacher',
                            foreignField: '_id',
                            as: 'teacher'
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
                        $lookup: {
                            from: 'districts',
                            localField: 'district',
                            foreignField: '_id',
                            as: 'district'
                        }
                    },
                    {
                        $addFields: {
                            teacher: { $arrayElemAt: ['$teacher', 0] },
                            school: { $arrayElemAt: ['$school', 0] },
                            district: { $arrayElemAt: ['$district', 0] }
                        }
                    }
                ]
            }
        });

        // Lookup exam data
        pipeline.push({
            $lookup: {
                from: 'exams',
                localField: 'exam',
                foreignField: '_id',
                as: 'exam'
            }
        });

        pipeline.push({
            $addFields: {
                studentData: { $arrayElemAt: ['$studentData', 0] },
                exam: { $arrayElemAt: ['$exam', 0] }
            }
        });

        // Apply filters
        const filterConditions: any[] = [];

        // Search by student name
        if (filters.search) {
            const searchTerms = filters.search.trim().split(/\s+/);
            
            if (searchTerms.length === 1) {
                // Single word search - check firstName OR lastName
                filterConditions.push({
                    $or: [
                        { 'studentData.firstName': { $regex: searchTerms[0], $options: 'i' } },
                        { 'studentData.lastName': { $regex: searchTerms[0], $options: 'i' } }
                    ]
                });
            } else {
                // Multiple words - check if all words are found in firstName+lastName combination
                const nameConditions = searchTerms.map(term => ({
                    $or: [
                        { 'studentData.firstName': { $regex: term, $options: 'i' } },
                        { 'studentData.lastName': { $regex: term, $options: 'i' } }
                    ]
                }));
                
                filterConditions.push({
                    $and: nameConditions
                });
            }
        }

        // Filter by student code
        if (filters.code) {
            filterConditions.push({
                'studentData.code': filters.code
            });
        }

        // Filter by district
        if (filters.districtIds && filters.districtIds.length > 0) {
            const districtObjectIds = filters.districtIds.map(id => new Types.ObjectId(id));
            filterConditions.push({
                'studentData.district._id': { $in: districtObjectIds }
            });
        }

        // Filter by school
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            const schoolObjectIds = filters.schoolIds.map(id => new Types.ObjectId(id));
            filterConditions.push({
                'studentData.school._id': { $in: schoolObjectIds }
            });
        }

        // Filter by teacher
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            const teacherObjectIds = filters.teacherIds.map(id => new Types.ObjectId(id));
            filterConditions.push({
                'studentData.teacher._id': { $in: teacherObjectIds }
            });
        }

        // Filter by exam
        if (filters.examIds && filters.examIds.length > 0) {
            console.log('🔥 Filtering by examIds:', filters.examIds);
            const examObjectIds = filters.examIds.map(id => new Types.ObjectId(id));
            console.log('🔥 Exam ObjectIds:', examObjectIds);
            filterConditions.push({
                'exam._id': { $in: examObjectIds }
            });
        }

        if (filterConditions.length > 0) {
            console.log('📋 Filter Conditions:', JSON.stringify(filterConditions, null, 2));
            pipeline.push({
                $match: {
                    $and: filterConditions
                }
            });
        }

        // Get total count
        const countPipeline = [...pipeline, { $count: 'total' }];
        const countResult = await StudentResult.aggregate(countPipeline);
        const totalCount = countResult.length > 0 ? countResult[0].total : 0;

        // Sorting
        const sortStage: any = {};
        if (sortColumn === 'exam.date') {
            sortStage['exam.date'] = sortDirection === 'asc' ? 1 : -1;
        } else if (sortColumn === 'student.code') {
            sortStage['studentData.code'] = sortDirection === 'asc' ? 1 : -1;
        } else if (sortColumn === 'student.lastName') {
            sortStage['studentData.lastName'] = sortDirection === 'asc' ? 1 : -1;
        } else if (sortColumn === 'grade') {
            sortStage['grade'] = sortDirection === 'asc' ? 1 : -1;
        } else if (sortColumn === 'totalScore') {
            sortStage['totalScore'] = sortDirection === 'asc' ? 1 : -1;
        } else if (sortColumn === 'level') {
            sortStage['level'] = sortDirection === 'asc' ? 1 : -1;
        } else {
            // Default sort
            sortStage['exam.date'] = -1;
            sortStage['studentData.code'] = 1;
        }

        pipeline.push({ $sort: sortStage });

        // Pagination
        const skip = (page - 1) * size;
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: size });

        // Execute aggregation
        const data = await StudentResult.aggregate(pipeline);

        return { data, totalCount };
    }

    async getExamResultById(id: string): Promise<IStudentResult | null> {
        return await StudentResult.findById(id)
            .populate({
                path: 'student',
                populate: [
                    { path: 'teacher', model: 'Teacher' },
                    { path: 'school', model: 'School' },
                    { path: 'district', model: 'District' }
                ]
            })
            .populate('exam');
    }
}