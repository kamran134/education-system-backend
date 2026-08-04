/**
 * Read-only integrity audit of the İSİM production database.
 *
 * Performs ZERO writes — only find / aggregate / countDocuments.
 * See ../../BACKEND_CLEANUP_PLAN.md task 0 for what each check is for.
 *
 * Usage (never hardcode credentials in this file):
 *   MONGO_URI="mongodb://user:pass@host:27017/kpm?authSource=admin" node scripts/audit-integrity.js
 *
 * Writes a machine-readable summary to audit-report.json for sending onward.
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error('MONGO_URI is not set. Refusing to guess a connection string.');
    process.exit(1);
}

// Code hierarchy: District 3 -> School 5 -> Teacher 7 -> Student 10 digits.
const STUDENT_TO_TEACHER = 1_000;
const STUDENT_TO_SCHOOL = 100_000;
const STUDENT_TO_DISTRICT = 10_000_000;
const SCHOOL_TO_DISTRICT = 100;

const report = {};

function head(title) {
    console.log('\n' + '='.repeat(70));
    console.log(title);
    console.log('='.repeat(70));
}

async function main() {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const students = db.collection('students');
    const teachers = db.collection('teachers');
    const schools = db.collection('schools');
    const districts = db.collection('districts');
    const exams = db.collection('exams');
    const results = db.collection('studentresults');
    const users = db.collection('users');

    // ---------- 0. Collection sizes ----------
    head('0. РАЗМЕРЫ КОЛЛЕКЦИЙ');
    const counts = {};
    for (const [name, col] of Object.entries({
        students, teachers, schools, districts, exams, studentResults: results, users,
    })) {
        counts[name] = await col.countDocuments();
        console.log(`  ${name.padEnd(16)} ${counts[name]}`);
    }
    report.counts = counts;

    // ---------- 1. Duplicate student codes ----------
    head('1. ДУБЛИ КОДОВ УЧЕНИКОВ (главный чек — блокирует unique-индекс)');
    const dupes = await students.aggregate([
        { $group: { _id: '$code', count: { $sum: 1 }, docs: { $push: { id: '$_id', lastName: '$lastName', firstName: '$firstName', grade: '$grade' } } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
    ]).toArray();

    console.log(`  Групп с дублирующимся кодом: ${dupes.length}`);
    const dupeStudentTotal = dupes.reduce((s, g) => s + g.count, 0);
    console.log(`  Всего записей в этих группах: ${dupeStudentTotal}`);
    dupes.slice(0, 15).forEach(g => {
        const who = g.docs.map(d => `${d.lastName || '?'} ${d.firstName || '?'} (${d.grade ?? '?'} кл)`).join(' | ');
        console.log(`    code ${g._id} x${g.count}: ${who}`);
    });
    if (dupes.length > 15) console.log(`    ... и ещё ${dupes.length - 15} групп (полный список в audit-report.json)`);
    report.duplicateStudentCodes = { groups: dupes.length, records: dupeStudentTotal, detail: dupes };

    // ---------- 2. Missing / broken refs ----------
    head('2. ОТСУТСТВУЮЩИЕ И БИТЫЕ ССЫЛКИ У УЧЕНИКОВ');
    const missing = {
        teacher: await students.countDocuments({ $or: [{ teacher: { $exists: false } }, { teacher: null }] }),
        school: await students.countDocuments({ $or: [{ school: { $exists: false } }, { school: null }] }),
        district: await students.countDocuments({ $or: [{ district: { $exists: false } }, { district: null }] }),
    };
    console.log(`  Без учителя: ${missing.teacher}`);
    console.log(`  Без школы:   ${missing.school}`);
    console.log(`  Без района:  ${missing.district}`);

    const teacherIds = new Set((await teachers.find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    const schoolIds = new Set((await schools.find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    const districtIds = new Set((await districts.find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));

    const broken = { teacher: 0, school: 0, district: 0 };
    const cursor = students.find({}, { projection: { code: 1, teacher: 1, school: 1, district: 1 } });
    const codeMismatch = { teacher: 0, school: 0, district: 0 };
    const mismatchSamples = [];
    const overflowCheck = new Map(); // teacher ObjectId -> student count

    const teacherByIdCode = new Map((await teachers.find({}, { projection: { _id: 1, code: 1, school: 1 } }).toArray())
        .map(t => [String(t._id), t]));
    const schoolByIdCode = new Map((await schools.find({}, { projection: { _id: 1, code: 1, districtCode: 1, district: 1 } }).toArray())
        .map(s => [String(s._id), s]));
    const districtByIdCode = new Map((await districts.find({}, { projection: { _id: 1, code: 1, region: 1 } }).toArray())
        .map(d => [String(d._id), d]));

    for await (const s of cursor) {
        if (s.teacher && !teacherIds.has(String(s.teacher))) broken.teacher++;
        if (s.school && !schoolIds.has(String(s.school))) broken.school++;
        if (s.district && !districtIds.has(String(s.district))) broken.district++;

        if (s.teacher) overflowCheck.set(String(s.teacher), (overflowCheck.get(String(s.teacher)) || 0) + 1);

        if (typeof s.code !== 'number') continue;
        const expTeacher = Math.floor(s.code / STUDENT_TO_TEACHER);
        const expSchool = Math.floor(s.code / STUDENT_TO_SCHOOL);
        const expDistrict = Math.floor(s.code / STUDENT_TO_DISTRICT);

        const t = s.teacher && teacherByIdCode.get(String(s.teacher));
        const sc = s.school && schoolByIdCode.get(String(s.school));
        const d = s.district && districtByIdCode.get(String(s.district));

        let bad = false;
        if (t && t.code !== expTeacher) { codeMismatch.teacher++; bad = true; }
        if (sc && sc.code !== expSchool) { codeMismatch.school++; bad = true; }
        if (d && d.code !== expDistrict) { codeMismatch.district++; bad = true; }
        if (bad && mismatchSamples.length < 20) {
            mismatchSamples.push({
                studentCode: s.code,
                expected: { teacher: expTeacher, school: expSchool, district: expDistrict },
                actual: { teacher: t && t.code, school: sc && sc.code, district: d && d.code },
            });
        }
    }
    console.log(`  Ссылка на несуществующего учителя: ${broken.teacher}`);
    console.log(`  Ссылка на несуществующую школу:    ${broken.school}`);
    console.log(`  Ссылка на несуществующий район:    ${broken.district}`);
    report.missingRefs = missing;
    report.brokenRefs = broken;

    // ---------- 3. Code vs ref mismatch ----------
    head('3. КОД НЕ СООТВЕТСТВУЕТ ПРИВЯЗКЕ (эти записи каскад из п.4 испортит)');
    console.log(`  Расходится код учителя: ${codeMismatch.teacher}`);
    console.log(`  Расходится код школы:   ${codeMismatch.school}`);
    console.log(`  Расходится код района:  ${codeMismatch.district}`);
    mismatchSamples.slice(0, 10).forEach(m => {
        console.log(`    ученик ${m.studentCode}: ожидался учитель ${m.expected.teacher}, привязан ${m.actual.teacher}`);
    });
    report.codeMismatch = { counts: codeMismatch, samples: mismatchSamples };

    // ---------- 4. School.districtCode drift ----------
    head('4. SCHOOL.districtCode РАСХОДИТСЯ С КОДОМ РАЙОНА');
    let schoolDriftCount = 0;
    const schoolDrift = [];
    for (const sc of schoolByIdCode.values()) {
        const d = sc.district && districtByIdCode.get(String(sc.district));
        const expFromOwnCode = Math.floor(sc.code / SCHOOL_TO_DISTRICT);
        if (d && sc.districtCode !== d.code) {
            schoolDriftCount++;
            if (schoolDrift.length < 20) schoolDrift.push({ schoolCode: sc.code, districtCode: sc.districtCode, actualDistrict: d.code, derivedFromOwnCode: expFromOwnCode });
        }
    }
    console.log(`  Школ с расхождением: ${schoolDriftCount}`);
    schoolDrift.slice(0, 10).forEach(s => console.log(`    школа ${s.schoolCode}: districtCode=${s.districtCode}, реальный район=${s.actualDistrict}`));
    report.schoolDistrictCodeDrift = { count: schoolDriftCount, samples: schoolDrift };

    // ---------- 5. District.region values ----------
    head('5. ЗНАЧЕНИЯ DISTRICT.region (нужно для миграции в сущность Region)');
    const regionAgg = await districts.aggregate([
        { $group: { _id: '$region', count: { $sum: 1 }, districts: { $push: '$name' } } },
        { $sort: { count: -1 } },
    ]).toArray();
    regionAgg.forEach(r => {
        console.log(`  ${JSON.stringify(r._id)} -> ${r.count} районов`);
    });
    report.regions = regionAgg;

    // ---------- 6. Orphan parents ----------
    head('6. СИРОТЫ В ИЕРАРХИИ');
    const orphans = {
        teachersWithoutSchool: await teachers.countDocuments({ $or: [{ school: { $exists: false } }, { school: null }] }),
        teachersWithoutDistrict: await teachers.countDocuments({ $or: [{ district: { $exists: false } }, { district: null }] }),
        schoolsWithoutDistrict: await schools.countDocuments({ $or: [{ district: { $exists: false } }, { district: null }] }),
    };
    console.log(`  Учителей без школы:  ${orphans.teachersWithoutSchool}`);
    console.log(`  Учителей без района: ${orphans.teachersWithoutDistrict}`);
    console.log(`  Школ без района:     ${orphans.schoolsWithoutDistrict}`);

    const dupTeacherCodes = await teachers.aggregate([
        { $group: { _id: '$code', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } },
    ]).toArray();
    const dupSchoolCodes = await schools.aggregate([
        { $group: { _id: '$code', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } },
    ]).toArray();
    console.log(`  Дубли кодов учителей: ${dupTeacherCodes.length}`);
    console.log(`  Дубли кодов школ:     ${dupSchoolCodes.length}`);
    report.orphans = orphans;
    report.duplicateParentCodes = { teachers: dupTeacherCodes.length, schools: dupSchoolCodes.length };

    // ---------- 7. Code space overflow ----------
    head('7. ПЕРЕПОЛНЕНИЕ КОДОВОГО ПРОСТРАНСТВА');
    const hotTeachers = [...overflowCheck.entries()]
        .map(([id, n]) => ({ code: teacherByIdCode.get(id) && teacherByIdCode.get(id).code, students: n }))
        .filter(t => t.students >= 900)
        .sort((a, b) => b.students - a.students);
    console.log(`  Учителей с >=900 учеников (лимит 999): ${hotTeachers.length}`);
    hotTeachers.slice(0, 10).forEach(t => console.log(`    учитель ${t.code}: ${t.students} учеников`));

    const teachersPerSchool = new Map();
    for (const t of teacherByIdCode.values()) {
        if (!t.school) continue;
        const k = String(t.school);
        teachersPerSchool.set(k, (teachersPerSchool.get(k) || 0) + 1);
    }
    const hotSchools = [...teachersPerSchool.entries()]
        .map(([id, n]) => ({ code: schoolByIdCode.get(id) && schoolByIdCode.get(id).code, teachers: n }))
        .filter(s => s.teachers >= 90)
        .sort((a, b) => b.teachers - a.teachers);
    console.log(`  Школ с >=90 учителей (лимит 99): ${hotSchools.length}`);
    hotSchools.slice(0, 10).forEach(s => console.log(`    школа ${s.code}: ${s.teachers} учителей`));
    report.overflow = { teachers: hotTeachers, schools: hotSchools };

    // ---------- 8. Results integrity ----------
    head('8. РЕЗУЛЬТАТЫ ЭКЗАМЕНОВ');
    const resultsWithoutExam = await results.countDocuments({ $or: [{ exam: { $exists: false } }, { exam: null }] });
    const studentIdSet = new Set((await students.find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
    let resultsOrphanStudent = 0;
    for await (const r of results.find({}, { projection: { student: 1 } })) {
        if (!r.student || !studentIdSet.has(String(r.student))) resultsOrphanStudent++;
    }
    console.log(`  Результатов без экзамена:        ${resultsWithoutExam}`);
    console.log(`  Результатов без живого ученика:  ${resultsOrphanStudent}`);
    report.results = { withoutExam: resultsWithoutExam, orphanStudent: resultsOrphanStudent };

    const outPath = path.join(__dirname, '..', 'audit-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nПолный отчёт: ${outPath}`);

    await client.close();
}

main().catch(err => {
    console.error('AUDIT FAILED:', err.message);
    process.exit(1);
});
