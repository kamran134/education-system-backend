import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class CreateTeacherDto {
    @IsString()
    code!: string;

    @IsString()
    firstName!: string;

    @IsString()
    lastName!: string;

    @IsString()
    @IsOptional()
    middleName?: string;

    @IsMongoId()
    @IsOptional()
    district?: string;

    @IsMongoId()
    @IsOptional()
    school?: string;
}

export class UpdateTeacherDto {
    @IsString()
    @IsOptional()
    code?: string;

    @IsString()
    @IsOptional()
    firstName?: string;

    @IsString()
    @IsOptional()
    lastName?: string;

    @IsString()
    @IsOptional()
    middleName?: string;

    @IsMongoId()
    @IsOptional()
    district?: string;

    @IsMongoId()
    @IsOptional()
    school?: string;
} 