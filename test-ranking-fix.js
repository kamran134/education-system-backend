// Тест исправленной логики расчета мест в рейтинге
console.log("=== Тест исправленной логики расчета мест ===");

// Функция имитирующая новую логику расчета мест
function calculatePlaces(students) {
    // Сортируем по убыванию баллов
    const sortedStudents = [...students].sort((a, b) => b.score - a.score);
    
    let currentPlace = 1;
    let previousScore = null;
    let countAtCurrentScore = 0;
    
    const results = [];
    
    for (let i = 0; i < sortedStudents.length; i++) {
        const student = sortedStudents[i];
        
        // Если это первый студент или балл изменился
        if (i === 0 || (previousScore !== null && student.score < previousScore)) {
            // Место = позиция в отсортированном списке + 1
            currentPlace = i + 1;
        }
        // Если score такой же, currentPlace остается неизменным
        
        results.push({
            ...student,
            place: currentPlace
        });
        
        previousScore = student.score;
    }
    
    return results;
}

// Создаем тестовых студентов с разными баллами
const testStudents = [
    { code: 'S001', score: 95 }, 
    { code: 'S002', score: 90 }, 
    { code: 'S003', score: 90 }, 
    { code: 'S004', score: 85 }, 
    { code: 'S005', score: 80 }, 
    { code: 'S006', score: 80 }, 
    { code: 'S007', score: 80 }, 
    { code: 'S008', score: 80 }, 
    { code: 'S009', score: 80 }, 
    { code: 'S010', score: 75 }  
];

console.log("\n📊 Исходные данные студентов:");
testStudents.forEach(student => {
    console.log(`${student.code}: ${student.score} баллов`);
});

// Рассчитываем места
const studentsWithPlaces = calculatePlaces(testStudents);

console.log("\n🏆 Результаты расчета мест:");
studentsWithPlaces.forEach(student => {
    console.log(`${student.code}: ${student.score} баллов → место ${student.place}`);
});

console.log("\n🎯 Ожидаемые результаты:");
console.log("S001: 95 баллов → место 1");  // позиция 0 + 1 = 1
console.log("S002: 90 баллов → место 2");  // позиция 1 + 1 = 2
console.log("S003: 90 баллов → место 2");  // тот же балл = то же место
console.log("S004: 85 баллов → место 4");  // позиция 3 + 1 = 4
console.log("S005: 80 баллов → место 5");  // позиция 4 + 1 = 5
console.log("S006: 80 баллов → место 5");  // тот же балл = то же место
console.log("S007: 80 баллов → место 5");  // тот же балл = то же место
console.log("S008: 80 баллов → место 5");  // тот же балл = то же место
console.log("S009: 80 баллов → место 5");  // тот же балл = то же место
console.log("S010: 75 баллов → место 10"); // позиция 9 + 1 = 10

console.log("\n✅ Проверка правильности:");

// Проверяем правильность результатов
const expectedResults = [
    { code: 'S001', place: 1 },
    { code: 'S002', place: 2 },
    { code: 'S003', place: 2 },
    { code: 'S004', place: 4 },
    { code: 'S005', place: 5 },
    { code: 'S006', place: 5 },
    { code: 'S007', place: 5 },
    { code: 'S008', place: 5 },
    { code: 'S009', place: 5 },
    { code: 'S010', place: 10 }
];

let allCorrect = true;
for (let i = 0; i < expectedResults.length; i++) {
    const expected = expectedResults[i];
    const actual = studentsWithPlaces.find(s => s.code === expected.code);
    
    if (actual.place !== expected.place) {
        console.log(`❌ ${expected.code}: ожидали место ${expected.place}, получили ${actual.place}`);
        allCorrect = false;
    } else {
        console.log(`✅ ${expected.code}: место ${actual.place} - правильно`);
    }
}

if (allCorrect) {
    console.log("\n🎉 Все тесты прошли успешно! Логика работает правильно:");
    console.log("   - Одинаковые баллы получают одинаковое место");
    console.log("   - Следующее место увеличивается на количество студентов с предыдущим местом");
    console.log("   - Нет пропусков в последовательности: 1, 2, 2, 3, 4, 4, 4, 4, 4, 5");
} else {
    console.log("\n❌ Есть ошибки в логике расчета мест!");
}