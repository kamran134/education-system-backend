# Изменения в системе валидации Excel загрузок

## Дата: 2025-11-11

### Краткое описание
Добавлена полная валидация для всех типов Excel загрузок с учетом иерархической структуры кодов (Район → Школа → Учитель → Студент).

---

## Изменения в коде

### 1. `src/types/common.types.ts`
Расширен тип `FileProcessingResult`:

```typescript
export interface FileProcessingResult<T> {
    processedData: T[];
    errors: string[];
    skippedItems: any[];
    validationErrors?: {
        invalidDistrictCodes?: number[];
        invalidSchoolCodes?: number[];
        invalidTeacherCodes?: number[];
        invalidStudentCodes?: number[];
    };
}
```

### 2. `src/services/teacher.service.ts`
**Метод:** `processTeachersFromExcel()`

**Добавлены валидации:**
- ✅ Коды учителей (7 цифр: 1000000-9999999)
- ✅ Коды школ (извлекаются из кода учителя)
- ✅ Коды районов (извлекаются из кода школы)

**Возвращает:**
```typescript
{
    processedData: ITeacher[],
    errors: string[],
    skippedItems: any[],
    validationErrors: {
        invalidTeacherCodes: number[],
        invalidSchoolCodes: number[],
        invalidDistrictCodes: number[]
    }
}
```

### 3. `src/services/school.service.ts`
**Метод:** `processSchoolsFromExcel()`

**Добавлены валидации:**
- ✅ Коды школ (5 цифр: 10000-99999)
- ✅ Коды районов (извлекаются из кода школы)

**Возвращает:**
```typescript
{
    processedData: ISchool[],
    errors: string[],
    skippedItems: any[],
    validationErrors: {
        invalidSchoolCodes: number[],
        invalidDistrictCodes: number[]
    }
}
```

### 4. `src/services/studentResult.service.ts`
**Метод:** `processStudentResultsFromExcel()`

**Добавлены валидации:**
- ✅ Коды студентов (10 цифр: 1000000000-9999999999)
- ✅ Коды учителей (извлекаются из кода студента)
- ✅ Коды школ (извлекаются из кода учителя)
- ✅ Коды районов (извлекаются из кода школы)
- ✅ Корректность баллов (totalScore = sum of all disciplines)

**Возвращает:**
```typescript
{
    processedData: IStudentResultInput[],
    results: BulkWriteResult,
    studentsWithoutTeacher: number[],
    studentsWithIncorrectResults: Array<{
        studentCode: number,
        totalScore: number,
        calculatedTotal: number,
        az: number,
        math: number,
        lifeKnowledge?: number,
        logic?: number,
        english?: number
    }>,
    validationErrors: {
        invalidStudentCodes: number[],
        invalidTeacherCodes: number[],
        invalidSchoolCodes: number[],
        invalidDistrictCodes: number[]
    }
}
```

---

## Иерархия кодов

```
Район (District)     123       (3 цифры)
    ↓
Школа (School)       12345     (5 цифр)
    ↓
Учитель (Teacher)    1234567   (7 цифр)
    ↓
Студент (Student)    1234567890 (10 цифр)
```

### Извлечение связанных кодов:

```javascript
// Из кода студента получаем код учителя
teacherCode = Math.floor(studentCode / 1000)
// 1234567890 → 1234567

// Из кода учителя получаем код школы
schoolCode = Math.floor(teacherCode / 100)
// 1234567 → 12345

// Из кода школы получаем код района
districtCode = Math.floor(schoolCode / 100)
// 12345 → 123
```

---

## Документация

Создан файл `EXCEL_VALIDATION.md` с подробной документацией:
- Описание всех валидаций для каждого типа загрузки
- Примеры ответов API
- Рекомендации для операторов
- Примеры UI для отображения ошибок

---

## Преимущества

### Для операторов:
1. **Полная прозрачность:** Видят все проблемные коды сразу после загрузки
2. **Экономия времени:** Не нужно искать ошибки вручную
3. **Предотвращение ошибок:** Невалидные данные не попадают в систему

### Для системы:
1. **Целостность данных:** Все связи (Район→Школа→Учитель→Студент) гарантированно корректны
2. **Отсутствие "висячих" записей:** Невозможно создать учителя без школы или студента без учителя
3. **Качество результатов:** Отфильтровываются записи с некорректными баллами

### Для разработки:
1. **Единый формат:** Все методы возвращают `FileProcessingResult<T>`
2. **Расширяемость:** Легко добавить новые типы валидаций
3. **Отладка:** Детальная информация о каждой ошибке

---

## Использование на фронтенде

После загрузки Excel файла:

```typescript
const response = await uploadExcel(file);

// Показать статистику
console.log(`Загружено: ${response.processedData.length}`);
console.log(`Пропущено: ${response.skippedItems.length}`);

// Показать ошибки валидации
if (response.validationErrors) {
    const { 
        invalidDistrictCodes, 
        invalidSchoolCodes, 
        invalidTeacherCodes, 
        invalidStudentCodes 
    } = response.validationErrors;
    
    if (invalidDistrictCodes?.length) {
        console.error('Неверные коды районов:', invalidDistrictCodes);
    }
    // ... и т.д.
}

// Для результатов экзаменов дополнительно:
if (response.studentsWithIncorrectResults?.length) {
    console.error('Студенты с неправильными баллами:', 
        response.studentsWithIncorrectResults);
}
```

---

## Тестирование

### Рекомендуемые тест-кейсы:

1. **Валидные данные:** Все записи должны загрузиться успешно
2. **Неверная длина кодов:** Должны попасть в `invalidXXXCodes`
3. **Несуществующие связи:** Учитель без школы → `invalidSchoolCodes`
4. **Неправильные баллы:** Должны попасть в `studentsWithIncorrectResults`
5. **Дубликаты:** Должны попасть в `skippedItems`

---

## Заключение

Система валидации теперь полностью защищена от ввода некорректных данных. Все проблемные записи отслеживаются и возвращаются оператору для исправления, что значительно повышает качество данных в системе.
