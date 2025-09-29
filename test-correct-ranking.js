// Тест логики рейтингов согласно требованию пользователя
console.log("=== Тест правильной логики рейтингов ===");
console.log("Требование: вместо '1, 2, 2, 4, 5, 5, 5, 5, 5, 10' должно быть '1, 2, 2, 3, 4, 4, 4, 4, 4, 5'");

// Правильная функция согласно требованию
function calculatePlacesCorrectly(students) {
    const sortedStudents = [...students].sort((a, b) => b.score - a.score);
    
    let nextPlace = 1; // следующее доступное место
    let previousScore = null;
    let countWithSameScore = 0;
    
    const results = [];
    
    for (let i = 0; i < sortedStudents.length; i++) {
        const student = sortedStudents[i];
        
        if (i === 0) {
            // Первый студент - место 1
            student.place = 1;
            previousScore = student.score;
            countWithSameScore = 1;
        } else if (student.score === previousScore) {
            // Тот же балл - то же место
            student.place = nextPlace;
            countWithSameScore++;
        } else {
            // Новый балл - следующее место = предыдущее место + 1
            nextPlace = nextPlace + 1;  // Не учитываем количество студентов!
            student.place = nextPlace;
            previousScore = student.score;
            countWithSameScore = 1;
        }
        
        results.push(student);
    }
    
    return results;
}

// Тестовые данные
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

console.log("\n📊 Исходные данные:");
testStudents.forEach(student => {
    console.log(`${student.code}: ${student.score} баллов`);
});

const studentsWithPlaces = calculatePlacesCorrectly(testStudents);

console.log("\n🏆 Результаты:");
studentsWithPlaces.forEach(student => {
    console.log(`${student.code}: ${student.score} баллов → место ${student.place}`);
});

// Проверка на соответствие требованию
const places = studentsWithPlaces.map(s => s.place);
const expectedSequence = [1, 2, 2, 3, 4, 4, 4, 4, 4, 5];

console.log("\n✅ Проверка:");
console.log("Полученная последовательность мест:", places.join(', '));
console.log("Ожидаемая последовательность мест: ", expectedSequence.join(', '));

let isCorrect = true;
for (let i = 0; i < expectedSequence.length; i++) {
    if (places[i] !== expectedSequence[i]) {
        console.log(`❌ Позиция ${i}: ожидали ${expectedSequence[i]}, получили ${places[i]}`);
        isCorrect = false;
    }
}

if (isCorrect) {
    console.log("🎉 УСПЕХ! Логика работает правильно!");
} else {
    console.log("❌ ОШИБКА! Логика требует исправления.");
}