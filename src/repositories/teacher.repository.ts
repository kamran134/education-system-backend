import { Model } from 'mongoose';
import { ITeacher } from '../models/teacher.model';
import { BaseRepository } from './base.repository';

export class TeacherRepository extends BaseRepository<ITeacher> {
    constructor(model: Model<ITeacher>) {
        super(model);
    }

    async findByCode(code: string): Promise<ITeacher | null> {
        return this.findOne({ code });
    }

    async findByDistrict(districtId: string): Promise<ITeacher[]> {
        return this.find({ district: districtId });
    }

    async findBySchool(schoolId: string): Promise<ITeacher[]> {
        return this.find({ school: schoolId });
    }
} 