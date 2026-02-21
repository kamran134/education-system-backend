# Legacy Import Plan — Schools (Köhnə bazadan inteqrasiya)

## Context

Old MongoDB export format (one school object example):
```json
{
  "_id": { "$oid": "..." },
  "code": 15001,
  "address": "...",
  "district": { "$oid": "..." },
  "districtCode": 150,
  "name": "Məktəb adı",
  "averageScore": 19.14,
  "score": 134,
  "active": true
}
```

## Rules

| Rule | Decision |
|------|----------|
| Academic year for old score/averageScore | **2024** (2024/2025 school year) |
| District resolution | Look up by `districtCode` in current DB (`Math.floor(code / 100)` also equals districtCode) |
| If district not found | Insert school with `district: null` |
| If school code already exists | **Skip** — report in results |
| Old `_id` | Discard — let MongoDB generate new `_id` |
| `place` in ratings | Set to `null` |

## Field Mapping

| Old field | New field |
|-----------|-----------|
| `code` | `code` |
| `name` | `name` |
| `address` | `address` |
| `districtCode` | `districtCode` |
| `active` | `active` |
| `district.$oid` | *(ignored)* |
| `score` | `ratings[0].score` (year=2024) |
| `averageScore` | `ratings[0].averageScore` (year=2024) |
| *(missing)* | `ratings[0].place = null` |

## Tasks

- [x] Create this plan file
- [x] `SchoolService.importLegacySchools(records)` — core logic
- [x] `SchoolUseCase.importLegacySchools(filePath)` — file parsing + orchestration
- [x] `SchoolController.importLegacySchools` — multer handler
- [x] `POST /api/schools/legacy-import` — new route (superadmin only)
- [x] Frontend: file input UI per section card (schools)
- [x] Frontend: service call + result display

## API

**Request:** `POST /api/schools/legacy-import`  
- Auth: `superadmin`  
- Body: `multipart/form-data`, field `file` = JSON file  
- Accepts both JSON array and newline-delimited JSON (mongoexport format)

**Response:**
```json
{
  "success": true,
  "data": {
    "inserted": 42,
    "skipped": 5,
    "errors": 1,
    "details": {
      "skippedCodes": [15002, 15008],
      "errorMessages": ["School 15099: ..."]
    }
  },
  "message": "Processed 48 records: 42 inserted, 5 skipped, 1 error"
}
```
