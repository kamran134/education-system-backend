import { Model } from 'mongoose';
import { IStudent } from '../models/student.model';
import { BaseRepository } from './base.repository';

export class StudentRepository extends BaseRepository<IStudent> {
    constructor(model: Model<IStudent>) {
        super(model);
    }

    async findByCode(code: string): Promise<IStudent | null> {
        return this.findOne({ code });
    }

    async findByTeacher(teacherId: string): Promise<IStudent[]> {
        return this.find({ teacher: teacherId });
    }

    async findBySchool(schoolId: string): Promise<IStudent[]> {
        return this.find({ school: schoolId });
    }

    async findByDistrict(districtId: string): Promise<IStudent[]> {
        return this.find({ district: districtId });
    }

    async searchStudents(searchString: string): Promise<IStudent[]> {
        return this.model.aggregate([
            {
                $addFields: {
                    fullName: {
                        $concat: ['$lastName', ' ', '$firstName', ' ', '$middleName'],
                    },
                },
            },
            {
                $match: {
                    fullName: { $regex: searchString, $options: 'i' },
                },
            },
            {
                $lookup: {
                    from: 'teachers',
                    localField: 'teacher',
                    foreignField: '_id',
                    as: 'teacher',
                },
            },
            {
                $unwind: {
                    path: '$teacher',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $lookup: {
                    from: 'schools',
                    localField: 'school',
                    foreignField: '_id',
                    as: 'school',
                },
            },
            {
                $unwind: {
                    path: '$school',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $lookup: {
                    from: 'districts',
                    localField: 'district',
                    foreignField: '_id',
                    as: 'district',
                },
            },
            {
                $unwind: {
                    path: '$district',
                    preserveNullAndEmptyArrays: true,
                },
            },
        ]);
    }
} 