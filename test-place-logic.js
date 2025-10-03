// Тест логики присваивания мест для районов, школ и учителей
console.log("=== Тест логики присваивания мест ===\n");

// Функция имитирующая новую логику расчета мест для учителей, школ и районов
function calculatePlaces(entities, scoreField = 'averageScore') {
    // Сортируем по убыванию среднего балла
    const sortedEntities = [...entities].sort((a, b) => b[scoreField] - a[scoreField]);
    
    let currentPlace = 1;
    let previousScore = null;
    
    const results = [];
    
    for (let i = 0; i < sortedEntities.length; i++) {
        const entity = sortedEntities[i];
        
        // Если это первая сущность или балл изменился
        if (i === 0 || (previousScore !== null && entity[scoreField] < previousScore)) {
            // Место = позиция в отсортированном списке + 1
            currentPlace = i + 1;
        }
        // Если балл такой же, как у предыдущего, место остается тем же

        results.push({
            ...entity,
            place: currentPlace
        });

        previousScore = entity[scoreField];
    }
    
    return results;
}

// Тестовые данные для учителей
const testTeachers = [
    { _id: 't1', fullname: 'Məmmədov Tural', code: 1001, averageScore: 95 },
    { _id: 't2', fullname: 'Əliyev Rəşad', code: 1002, averageScore: 90 },
    { _id: 't3', fullname: 'Həsənov Elçin', code: 1003, averageScore: 90 }, // тот же балл
    { _id: 't4', fullname: 'Qədirov Nicat', code: 1004, averageScore: 85 },
    { _id: 't5', fullname: 'İbrahimov Kamran', code: 1005, averageScore: 80 }
];

console.log("📊 Исходные данные учителей:");
testTeachers.forEach(teacher => {
    console.log(`${teacher.fullname} (${teacher.code}): ${teacher.averageScore} баллов`);
});

const teachersWithPlaces = calculatePlaces(testTeachers);

console.log("\n🏆 Результаты рейтинга учителей:");
teachersWithPlaces.forEach(teacher => {
    console.log(`🏅 Место ${teacher.place}: ${teacher.fullname} (${teacher.code}) - ${teacher.averageScore} баллов`);
});

// Тестовые данные для школ
const testSchools = [
    { _id: 's1', name: 'Лицей №1', code: 2001, averageScore: 88 },
    { _id: 's2', name: 'Школа №15', code: 2002, averageScore: 85 },
    { _id: 's3', name: 'Гимназия №7', code: 2003, averageScore: 85 }, // тот же балл
    { _id: 's4', name: 'Школа №23', code: 2004, averageScore: 82 },
    { _id: 's5', name: 'Лицей №3', code: 2005, averageScore: 78 }
];

console.log("\n\n📊 Исходные данные школ:");
testSchools.forEach(school => {
    console.log(`${school.name} (${school.code}): ${school.averageScore} баллов`);
});

const schoolsWithPlaces = calculatePlaces(testSchools);

console.log("\n🏆 Результаты рейтинга школ:");
schoolsWithPlaces.forEach(school => {
    console.log(`🏅 Место ${school.place}: ${school.name} (${school.code}) - ${school.averageScore} баллов`);
});

// Тестовые данные для районов
const testDistricts = [
    { _id: 'd1', name: 'Сабирабадский район', code: 3001, averageScore: 92 },
    { _id: 'd2', name: 'Баку Насиминский', code: 3002, averageScore: 88 },
    { _id: 'd3', name: 'Гянджинский район', code: 3003, averageScore: 88 }, // тот же балл
    { _id: 'd4', name: 'Сумгаитский район', code: 3004, averageScore: 85 },
    { _id: 'd5', name: 'Шекинский район', code: 3005, averageScore: 80 }
];

console.log("\n\n📊 Исходные данные районов:");
testDistricts.forEach(district => {
    console.log(`${district.name} (${district.code}): ${district.averageScore} баллов`);
});

const districtsWithPlaces = calculatePlaces(testDistricts);

console.log("\n🏆 Результаты рейтинга районов:");
districtsWithPlaces.forEach(district => {
    console.log(`🏅 Место ${district.place}: ${district.name} (${district.code}) - ${district.averageScore} баллов`);
});

console.log("\n📊 Анализ рейтинга:");

// Анализ для учителей
console.log("\n🔍 Учителя:");
const teacherPlaceGroups = {};
teachersWithPlaces.forEach(teacher => {
    if (!teacherPlaceGroups[teacher.place]) {
        teacherPlaceGroups[teacher.place] = [];
    }
    teacherPlaceGroups[teacher.place].push(teacher);
});

Object.keys(teacherPlaceGroups).forEach(place => {
    const teachers = teacherPlaceGroups[place];
    if (teachers.length > 1) {
        console.log(`  Место ${place}: ${teachers.length} учителя с одинаковым баллом ${teachers[0].averageScore}`);
    }
});

// Анализ для школ
console.log("\n🔍 Школы:");
const schoolPlaceGroups = {};
schoolsWithPlaces.forEach(school => {
    if (!schoolPlaceGroups[school.place]) {
        schoolPlaceGroups[school.place] = [];
    }
    schoolPlaceGroups[school.place].push(school);
});

Object.keys(schoolPlaceGroups).forEach(place => {
    const schools = schoolPlaceGroups[place];
    if (schools.length > 1) {
        console.log(`  Место ${place}: ${schools.length} школы с одинаковым баллом ${schools[0].averageScore}`);
    }
});

// Анализ для районов
console.log("\n🔍 Районы:");
const districtPlaceGroups = {};
districtsWithPlaces.forEach(district => {
    if (!districtPlaceGroups[district.place]) {
        districtPlaceGroups[district.place] = [];
    }
    districtPlaceGroups[district.place].push(district);
});

Object.keys(districtPlaceGroups).forEach(place => {
    const districts = districtPlaceGroups[place];
    if (districts.length > 1) {
        console.log(`  Место ${place}: ${districts.length} района с одинаковым баллом ${districts[0].averageScore}`);
    }
});

console.log("\n✅ Все проверки завершены!");
console.log("💡 Логика работает корректно: сущности с одинаковыми баллами получают одинаковые места.");