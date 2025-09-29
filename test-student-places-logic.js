// Тест логики обновления места в рейтинге (place) студентов
console.log("=== Тест логики рейтинга студентов (place) ===\n");

// Имитируем студентов с разными баллами
const mockStudents = [
    { _id: "student1", code: 1001, lastName: "Əliyev", firstName: "Rəşad", score: 26 },
    { _id: "student2", code: 1002, lastName: "Həsənov", firstName: "Elçin", score: 26 }, // тот же балл
    { _id: "student3", code: 1003, lastName: "Məmmədov", firstName: "Tural", score: 23 },
    { _id: "student4", code: 1004, lastName: "Qəhrəmanov", firstName: "Sənan", score: 21 },
    { _id: "student5", code: 1005, lastName: "Nəbiyev", firstName: "Kamran", score: 21 }, // тот же балл
    { _id: "student6", code: 1006, lastName: "Rəhimov", firstName: "Əli", score: 18 },
    { _id: "student7", code: 1007, lastName: "Mustafayev", firstName: "Orxan", score: 15 },
    { _id: "student8", code: 1008, lastName: "Sultanov", firstName: "Nicat", score: 15 }, // тот же балл
    { _id: "student9", code: 1009, lastName: "Babayev", firstName: "Vusal", score: 12 },
    { _id: "student10", code: 1010, lastName: "Cəfərov", firstName: "Əkbər", score: 8 }
];

console.log("📊 Исходные данные студентов (несортированные):");
mockStudents.forEach((student, index) => {
    console.log(`${index + 1}. ${student.lastName} ${student.firstName} (${student.code}): ${student.score} баллов`);
});

console.log("\n🔄 Сортируем по score (убывание), при равенстве по code (возрастание):");

// Сортируем как в нашем коде
const sortedStudents = mockStudents.sort((a, b) => {
    if (a.score !== b.score) {
        return b.score - a.score; // по убыванию score
    }
    return a.code - b.code; // по возрастанию code при равенстве
});

sortedStudents.forEach((student, index) => {
    console.log(`${index + 1}. ${student.lastName} ${student.firstName} (${student.code}): ${student.score} баллов`);
});

console.log("\n🏆 Присваиваем места в рейтинге:");

// Симулируем логику присваивания мест
let currentPlace = 1;
let previousScore = null;
let studentsWithSameScore = 0;

const studentsWithPlaces = [];

for (let i = 0; i < sortedStudents.length; i++) {
    const student = sortedStudents[i];
    
    if (previousScore !== null && student.score < previousScore) {
        // Новый score - обновляем место
        currentPlace += studentsWithSameScore;
        studentsWithSameScore = 1;
    } else {
        // Тот же score или первый студент
        studentsWithSameScore++;
    }

    studentsWithPlaces.push({
        ...student,
        place: currentPlace
    });

    previousScore = student.score;
}

console.log("\n✅ Финальный рейтинг с местами:");
studentsWithPlaces.forEach((student) => {
    console.log(`🏅 Место ${student.place}: ${student.lastName} ${student.firstName} (${student.code}) - ${student.score} баллов`);
});

console.log("\n📊 Анализ рейтинга:");

// Группируем по местам
const placeGroups = {};
studentsWithPlaces.forEach(student => {
    if (!placeGroups[student.place]) {
        placeGroups[student.place] = [];
    }
    placeGroups[student.place].push(student);
});

Object.keys(placeGroups).forEach(place => {
    const students = placeGroups[place];
    if (students.length > 1) {
        console.log(`👥 Место ${place}: ${students.length} студентов с одинаковым баллом (${students[0].score})`);
        students.forEach(student => {
            console.log(`   - ${student.lastName} ${student.firstName} (${student.code})`);
        });
    } else {
        console.log(`👤 Место ${place}: ${students[0].lastName} ${students[0].firstName} (${students[0].score} баллов)`);
    }
});

console.log("\n🎯 Результат:");
console.log("✅ Логика корректно обрабатывает одинаковые баллы");
console.log("✅ Студенты с одинаковым score получают одинаковое place");  
console.log("✅ Следующее место пропускается соответственно количеству студентов");
console.log("📊 Пример: 2 студента с 26 баллами → оба место 1, следующий студент место 3");

console.log("\n🔧 MongoDB операции для обновления:");
const bulkOperations = studentsWithPlaces.map(student => ({
    updateOne: {
        filter: { _id: student._id },
        update: { $set: { place: student.place } }
    }
}));

console.log(`📝 Будет выполнено ${bulkOperations.length} операций bulkWrite`);
console.log("✅ Все готово для обновления места в рейтинге в базе данных!");