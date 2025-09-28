// Тест логики с проверкой лицейного уровня
console.log("=== Тест логики updateStats с проверкой лицейного уровня ===");

// Функция проверки лицейного уровня
function isLiceyLevel(level) {
    const normalizedLevel = level.trim().toUpperCase();
    return normalizedLevel === 'LISEY' || normalizedLevel === 'LISE' || normalizedLevel.includes('LISEY');
}

// Имитируем результаты студентов за месяц
const mockStudentResults = [
    // 5 класс, район 1
    { grade: 5, totalScore: 85, level: 'B', student: { district: { _id: "district1" } } },
    { grade: 5, totalScore: 90, level: 'A', student: { district: { _id: "district1" } } }, // максимум, но НЕ лицейный
    { grade: 5, totalScore: 80, level: 'C', student: { district: { _id: "district1" } } },

    // 5 класс, район 2  
    { grade: 5, totalScore: 88, level: 'Lisey', student: { district: { _id: "district2" } } }, // максимум в районе 2 и лицейный!
    { grade: 5, totalScore: 75, level: 'B', student: { district: { _id: "district2" } } },

    // 6 класс, район 1
    { grade: 6, totalScore: 95, level: 'Lisey', student: { district: { _id: "district1" } } }, // максимум и лицейный!
    { grade: 6, totalScore: 82, level: 'A', student: { district: { _id: "district1" } } },

    // 6 класс, район 2
    { grade: 6, totalScore: 87, level: 'A', student: { district: { _id: "district2" } } }, // максимум в районе, но НЕ лицейный
    { grade: 6, totalScore: 84, level: 'B', student: { district: { _id: "district2" } } },
];

// Группируем по классам и районам
const gradeDistrictGroups = new Map();
const gradeGroups = new Map();

for (const result of mockStudentResults) {
    const grade = result.grade;
    const districtId = result.student.district._id;
    const gradeDistrictKey = `${grade}-${districtId}`;

    // Группировка по классам и районам
    if (!gradeDistrictGroups.has(gradeDistrictKey)) {
        gradeDistrictGroups.set(gradeDistrictKey, []);
    }
    gradeDistrictGroups.get(gradeDistrictKey).push(result);

    // Группировка только по классам
    if (!gradeGroups.has(grade)) {
        gradeGroups.set(grade, []);
    }
    gradeGroups.get(grade).push(result);
}

console.log("\n🏆 Анализ лучших студентов по районам (с проверкой лицейного уровня):");

// Проверяем логику для районов
for (const [gradeDistrictKey, results] of gradeDistrictGroups.entries()) {
    const [grade, districtId] = gradeDistrictKey.split('-');
    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => isLiceyLevel(r.level));
    
    console.log(`\n📍 Класс ${grade}, район ${districtId}:`);
    console.log(`   Максимум ${maxTotalScore} баллов, студенты: ${studentsWithMaxScore.map(s => s.level).join(', ')}`);
    
    if (liceyStudentsWithMaxScore.length > 0) {
        console.log(`   ✅ Есть лицейные с максимальным баллом: ${liceyStudentsWithMaxScore.map(s => s.level).join(', ')}`);
        console.log(`   → ${liceyStudentsWithMaxScore.length} студент(ов) получают studentOfTheMonthScore = 5`);
    } else {
        console.log(`   ❌ Нет лицейных с максимальным баллом`);
        console.log(`   → Никто не получает studentOfTheMonthScore`);
    }
}

console.log("\n🎯 Анализ лучших студентов по республике (с проверкой лицейного уровня):");

// Проверяем логику для республики
for (const [grade, results] of gradeGroups.entries()) {
    const maxTotalScore = Math.max(...results.map(r => r.totalScore));
    const studentsWithMaxScore = results.filter(r => r.totalScore === maxTotalScore);
    const liceyStudentsWithMaxScore = studentsWithMaxScore.filter(r => isLiceyLevel(r.level));
    
    console.log(`\n🎯 Класс ${grade} (республика):`);
    console.log(`   Максимум ${maxTotalScore} баллов, студенты: ${studentsWithMaxScore.map(s => s.level).join(', ')}`);
    
    if (liceyStudentsWithMaxScore.length > 0) {
        console.log(`   ✅ Есть лицейные с максимальным баллом: ${liceyStudentsWithMaxScore.map(s => s.level).join(', ')}`);
        console.log(`   → ${liceyStudentsWithMaxScore.length} студент(ов) получают republicWideStudentOfTheMonthScore = 5`);
    } else {
        console.log(`   ❌ Нет лицейных с максимальным баллом`);
        console.log(`   → Никто не получает republicWideStudentOfTheMonthScore`);
    }
}

console.log("\n✅ Результат теста:");
console.log("- 5 класс, район 1: максимум 90 (уровень A) → НЕ лицейный → никого не награждаем");
console.log("- 5 класс, район 2: максимум 88 (уровень Lisey) → лицейный → студент получает +5");  
console.log("- 6 класс, район 1: максимум 95 (уровень Lisey) → лицейный → студент получает +5");
console.log("- 6 класс, район 2: максимум 87 (уровень A) → НЕ лицейный → никого не награждаем");
console.log("- Республика, 5 класс: максимум 90 (A) → НЕ лицейный → никого не награждаем");
console.log("- Республика, 6 класс: максимум 95 (Lisey) → лицейный → студент получает +5");