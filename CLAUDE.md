# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Backend for the İSİM education/exam rating system. Angular frontend lives in a sibling repo (`education-system-front`) and talks to this over REST.

## Commands
- `npm run dev` — nodemon on `src/index.ts` (dev server)
- `npm run build` — `tsc` to `dist/`
- `npm start` — `node dist/index.js` (runs the build, not the sources)
- `npm test` — **stub that exits 1. There are zero tests in this repo.** Nothing is covered; never assume a change is verified because it compiles.

## Architecture

Express 4 + Mongoose 8 + TypeScript, MongoDB. Layering is `routes → controllers → usecases → services → models`:

- `routes/*.routes.ts` — one file per domain, mounted in `index.ts` under `/api/<domain>`.
- `controllers/*` — parse the request (`RequestParser`), apply **role-based data scoping** (see below), call a usecase, respond via `ResponseHandler`. DI is manual: each controller `new`s up its services in its own constructor — there is no container.
- `usecases/*` — validation (`ValidationUtils`) + orchestration across services. Thin.
- `services/*` — data access **and** business logic. This is where Mongoose lives and where the real weight is (`stats.service.ts` is 1866 lines).
- `models/*` — Mongoose schemas. **No repository layer**: models are imported directly by ~32 of 83 files, including some controllers. Don't introduce a repository abstraction ad hoc; it's an open decision (see `../BACKEND_CLEANUP_PLAN.md`).

Shared utils worth knowing before writing anything new: `response-handler.util.ts` (every response goes through `ResponseHandler.success/notFound/internalError`), `request-parser.util.ts` (`parsePagination`/`parseFilterOptions`/`parseSorting`), `filter.util.ts`, `ranking.util.ts`, `stats.utils.ts`, `academic-year.util.ts`, `memory-cache.util.ts`.

### Entity code system — read this before touching any code field

`utils/entity-codes.const.ts` defines a hierarchy where **child codes arithmetically contain parent codes**:

```
District 3 digits → School 5 → Teacher 7 → Student 10
teacher = floor(student / 1000)     school = floor(student / 100000)
district = floor(student / 10000000)   school = floor(teacher / 100)
```

Consequences that bite:
- Changing a school or teacher code invalidates every descendant code. There is no cascade today — see `../PHASE3_PLAN.md` п.4.
- `Student.code` has **no unique index** (`student.model.ts:70`; the index on line 96 is non-unique), while `District`/`School`/`Teacher`/`Exam`/`User` codes all do. Duplicate student codes insert silently.
- `School.districtCode` (`school.model.ts:62`) is a denormalized copy of the district's code and must be kept in sync manually.
- `services/student.service.ts` `assignTeacherToStudent()` derives teacher/school/district refs by decoding the student's own code. `repairStudentAssignments()` / `repairTeacherAssignments()` re-derive refs for records with **missing** refs only — they are manual admin operations, not automatic, and they only run code → refs, never refs → code.

### Rating chain — the core domain flow

Scores cascade upward, each level recomputed from the level below by `services/stats.service.ts`:

```
StudentResult → updateStudentScores() (:1216) → Student.score/averageScore
  → updateTeacherScores() (:1403, sum of its students) → Teacher
  → updateSchoolScores() → School → updateDistrictScores() → District
```

- Academic year is September–June; `utils/academic-year.util.ts` `getCurrentAcademicYear()`. `updateStudentScores` selects the year with an `$or` over month/year pairs, not a single field.
- Every rankable entity carries an embedded `ratings[]` array of per-year snapshots (`{year, score, averageScore, place, districtPlace}`) **plus** denormalized current-year flat fields. Both must be written; `stats.service.ts` projects flat fields from `ratings[]` at read time in places.
- Places use **dense ranking** (ties share a place), via `utils/ranking.util.ts` (`buildDenseRankMap` / `assignPlaces` / `updateEntityPlaces`). Students are ranked **within each grade separately**, districts/schools/teachers globally plus a `districtPlace` scope.
- `updateTeacherScores` divides by the stored `studentCount` field, **not** by the number of students actually joined. If `studentCount` is stale, averages are wrong. Preserve this deliberately or fix it deliberately — don't change it by accident.
- Aggregations that sort by name use `.collation({ locale: 'az', strength: 2 })` (4 call sites in `stats.service.ts`). Azerbaijani ordering is a requirement, not decoration.
- `models/exam.model.ts` has only `name`/`code`/`date`/`active` — no type or category. "Logic" and "English" exist today as optional **disciplines inside a result** (`studentResult.model.ts`: `disciplines.{az, math, lifeKnowledge, logic, english}`), not as exam kinds.

### Role-based data scoping — this is the security boundary

Every list endpoint narrows its query by the caller's role, as an **inline block duplicated in 5 controllers** (`student.controller.ts:29`, `teacher.controller.ts:31`, `school.controller.ts:31`, `district.controller.ts:31`, `stat.controller.ts:56`):

```
districtRepresenter → filters.districtIds = [req.user.districtId]
schoolDirector      → filters.schoolIds   = [req.user.schoolId]
teacher             → filters.teacherIds  = [req.user.teacherId]
student             → only their own record
```

`req.user` is populated by `middleware/auth.middleware.ts` from the JWT. The frontend's RBAC config only hides UI — **row-level scoping is enforced here and nowhere else**. When adding a role, every one of those 5 blocks needs updating, and the frontend's `core/config/rbac.config.ts` needs a value for every permission key (a missing key there is a silent bug, not a compile error).

Auth: JWT access + refresh, refresh tokens stored as an array on the user doc (max 5 sessions) and sent as an httpOnly cookie. `controllers/auth.controller.ts` + `services/token.service.ts`.

### Uploads

`config/multer.ts` (`avatarUpload`, `bulkAvatarUpload`) + `utils/smart-crop.util.ts` (face-aware crop via `sharp`). **Only `Student` has an `avatarUrl`** — no other entity supports photos yet. Files are written to the local disk under `uploads/`, served statically from `index.ts:68`. There is no S3/cloud storage, so uploads do not survive a container with an ephemeral filesystem.

## Traps

- **Zero tests, zero transactions.** No `startSession`/`startTransaction` anywhere; whether prod runs a replica set is unverified, and Mongo transactions need one. Anything touching money or multi-document consistency has no atomicity today.
- **Weak schemas:** 82 `required: false` vs 35 `required: true`. The schema guarantees very little; validate in the usecase layer.
- **`express-validator` is a dependency but used in `auth.controller.ts` only.** Everywhere else validation is ad-hoc via `ValidationUtils`. Follow `ValidationUtils` unless you're in auth.
- **A global `errorHandler` middleware exists** (`middleware/errorHandler`, imported in `index.ts`) but is effectively bypassed: all 13 controllers wrap every method in their own try/catch (~109 blocks). Match the surrounding style rather than half-migrating a file to the global handler.
- **`src/_backups_ratings_migration/` is dead code** — `.backup` copies from a February 2026 ratings migration. It sits inside `src/` and gets compiled. Never edit, never import; it is not a reference for current behavior.
- **`utils/migrate-ratings.ts`** is a one-off migration script living in utils, not a library.
- Request body limit is 100 MB (`index.ts:63`) for Excel/bulk uploads.

## Excel

Reading is server-side via `services/excel.service.ts` (`readExcel`, `xlsx` package). Note that **students are created as a side effect of importing exam results**: `services/studentResult.service.ts:114` `insertMany`s any student code it doesn't find. There is no standalone "register students" importer, and student codes always arrive from the file — nothing generates them server-side.

## Commit style

Short, lowercase, informal prefixes: `fix:`, `feature:`, `bugfix:`. Not strictly enforced; plain descriptive and occasional non-English messages appear in history. Match the terse style, don't impose Conventional Commits.

## Related planning docs

In the parent directory (outside both git repos): `PHASE3_PLAN.md` (current feature work), `BACKEND_CLEANUP_PLAN.md` (integrity/quality tasks), `MONGO_TO_POSTGRES.md` (query translation reference for a possible future migration).
