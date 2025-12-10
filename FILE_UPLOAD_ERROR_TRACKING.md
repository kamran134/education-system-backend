# File Upload Error Tracking

## Overview
This document describes the error tracking system for file uploads (teachers, schools, student results) implemented in the backend.

## Changes Made

### 1. Type Definitions (`src/types/common.types.ts`)
Extended `FileProcessingResult<T>` interface with comprehensive validation errors:

```typescript
export interface FileProcessingResult<T> {
    processedData: T[];
    validationErrors?: {
        // Teachers
        incorrectTeacherCodes?: number[];
        missingSchoolCodes?: number[];
        teacherCodesWithoutSchoolCodes?: number[];
        existingTeacherCodes?: number[];
        
        // Schools
        incorrectSchoolCodes?: number[];
        missingDistrictCodes?: number[];
        schoolCodesWithoutDistrictCodes?: number[];
        existingSchoolCodes?: number[];
        
        // Student Results
        incorrectStudentCodes?: number[];
        studentsWithoutTeacher?: number[];
        studentsWithIncorrectResults?: Array<{ code: number; reason: string }>;
    };
}
```

### 2. Teacher Service (`src/services/teacher.service.ts`)
- **Method**: `processTeachersFromExcel`
- **Row Start**: Row 4 (slice(4))
- **Validation Rules**:
  - Teacher code must be 7 digits (>= 1000000 && < 10000000)
  - School code must exist in database
  - Teacher must have school code in Excel
  - Checks for existing teachers

**Error Types Returned**:
- `incorrectTeacherCodes`: Teacher codes that don't match 7-digit format
- `missingSchoolCodes`: School codes that don't exist in database
- `teacherCodesWithoutSchoolCodes`: Teachers without school code in Excel
- `existingTeacherCodes`: Teachers that already exist in database

### 3. School Service (`src/services/school.service.ts`)
- **Method**: `processSchoolsFromExcel`
- **Row Start**: Row 4 (slice(4))
- **Validation Rules**:
  - School code must be 5 digits (> 9999, 5-digit validation)
  - District code must exist in database
  - School must have district code in Excel
  - Checks for existing schools

**Error Types Returned**:
- `incorrectSchoolCodes`: School codes that don't match 5-digit format
- `missingDistrictCodes`: District codes that don't exist in database
- `schoolCodesWithoutDistrictCodes`: Schools without district code in Excel
- `existingSchoolCodes`: Schools that already exist in database

### 4. Student Result Service (`src/services/studentResult.service.ts`)
- **Method**: `processStudentResultsFromExcel`
- **Validation Rules**:
  - Student code must be 10 digits
  - Student must have assigned teacher
  - Sum of points must match expected total (grade-based calculation)

**Error Types Returned**:
- `incorrectStudentCodes`: Student codes that don't match 10-digit format
- `studentsWithoutTeacher`: Students without assigned teacher
- `studentsWithIncorrectResults`: Students with sum mismatch, includes reason

## API Response Format

All file upload endpoints return:

```json
{
  "status": "success",
  "message": "File processed successfully",
  "data": [...],
  "validationErrors": {
    "incorrectTeacherCodes": [1234567],
    "missingSchoolCodes": [12345],
    "existingTeacherCodes": [1234567],
    ...
  }
}
```

## Notes
- All services use `bulkWrite` with `upsert` for efficiency
- Existing records are updated, not duplicated
- Validation happens before database operations
- Error arrays are only included if they contain data
