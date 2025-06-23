import { Document, Model, FilterQuery, UpdateQuery } from 'mongoose';

export interface IBaseRepository<T extends Document> {
    findById(id: string): Promise<T | null>;
    findOne(filter: FilterQuery<T>): Promise<T | null>;
    find(filter: FilterQuery<T>): Promise<T[]>;
    create(data: any): Promise<T>;
    update(id: string, data: UpdateQuery<T>): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    deleteMany(filter: FilterQuery<T>): Promise<boolean>;
}

export class BaseRepository<T extends Document> implements IBaseRepository<T> {
    constructor(protected readonly model: Model<T>) {}

    async findById(id: string): Promise<T | null> {
        return this.model.findById(id);
    }

    async findOne(filter: FilterQuery<T>): Promise<T | null> {
        return this.model.findOne(filter);
    }

    async find(filter: FilterQuery<T>): Promise<T[]> {
        return this.model.find(filter);
    }

    async create(data: any): Promise<T> {
        const entity = new this.model(data);
        return entity.save();
    }

    async update(id: string, data: UpdateQuery<T>): Promise<T | null> {
        return this.model.findByIdAndUpdate(id, data, { new: true });
    }

    async delete(id: string): Promise<boolean> {
        const result = await this.model.findByIdAndDelete(id);
        return !!result;
    }

    async deleteMany(filter: FilterQuery<T>): Promise<boolean> {
        const result = await this.model.deleteMany(filter);
        return result.deletedCount > 0;
    }
} 