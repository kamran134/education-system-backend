import { IsString, IsNumber, IsOptional, Length, IsMongoId } from 'class-validator';

export class CreateStudentDto {
    @IsString()
    @Length(10, 10, { message: 'Student code must be exactly 10 digits' })
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

    @IsMongoId()
    @IsOptional()
    teacher?: string;
}

export class UpdateStudentDto {
    @IsString()
    @IsOptional()
    @Length(10, 10, { message: 'Student code must be exactly 10 digits' })
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

    @IsMongoId()
    @IsOptional()
    teacher?: string;
} 