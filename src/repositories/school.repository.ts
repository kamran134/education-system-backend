import { Model } from 'mongoose';
import { ISchool } from '../models/school.model';
import { BaseRepository } from './base.repository';

export class SchoolRepository extends BaseRepository<ISchool> {
    constructor(model: Model<ISchool>) {
        super(model);
    }

    async findByName(name: string): Promise<ISchool | null> {
        return this.findOne({ name });
    }

    async findByDistrict(districtId: string): Promise<ISchool[]> {
        return this.find({ district: districtId });
    }
} 