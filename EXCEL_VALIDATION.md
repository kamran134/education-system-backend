# Excel Upload Validation

Система валидации для загрузки данных из Excel файлов. Все проблемные записи отслеживаются и возвращаются в ответе для анализа.

## Общая структура ответа

Все методы обработки Excel возвращают объект типа `FileProcessingResult<T>`:

```typescript
interface FileProcessingResult<T> {
    processedData: T[];           // Успешно обработанные записи
    errors: string[];             // Ошибки обработки
    skippedItems: any[];          // Пропущенные записи (дубликаты)
    validationErrors?: {          // Проблемные коды из Excel
        invalidDistrictCodes?: number[];
        invalidSchoolCodes?: number[];
        invalidTeacherCodes?: number[];
        invalidStudentCodes?: number[];
    };
}
```

## 1. Загрузка учителей (processTeachersFromExcel)

### Валидации:

#### 1.1 Валидация кода учителя
- **Корректный диапазон:** 1000000 - 9999999 (7 цифр)
- **Неверные коды:** Возвращаются в `validationErrors.invalidTeacherCodes`

#### 1.2 Валидация кода школы
- **Извлечение:** Первые 5 цифр из кода учителя (teacherCode / 100)
- **Проверка:** Существует ли школа с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidSchoolCodes`

#### 1.3 Валидация кода района
- **Извлечение:** Первые 3 цифры из кода школы (schoolCode / 100)
- **Проверка:** Существует ли район с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidDistrictCodes`

### Пример ответа:

```json
{
    "processedData": [...],
    "errors": ["Invalid teacher code: 123"],
    "skippedItems": [{"code": 1234567, "reason": "Already exists"}],
    "validationErrors": {
        "invalidTeacherCodes": [123, 456],
        "invalidSchoolCodes": [123],
        "invalidDistrictCodes": [12]
    }
}
```

## 2. Загрузка школ (processSchoolsFromExcel)

### Валидации:

#### 2.1 Валидация кода школы
- **Корректный диапазон:** 10000 - 99999 (5 цифр)
- **Неверные коды:** Возвращаются в `validationErrors.invalidSchoolCodes`

#### 2.2 Валидация кода района
- **Извлечение:** Первые 3 цифры из кода школы (schoolCode / 100)
- **Проверка:** Существует ли район с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidDistrictCodes`

### Пример ответа:

```json
{
    "processedData": [...],
    "errors": ["Invalid school code: 999"],
    "skippedItems": [{"code": 12345, "reason": "Already exists"}],
    "validationErrors": {
        "invalidSchoolCodes": [999, 888],
        "invalidDistrictCodes": [99]
    }
}
```

## 3. Загрузка результатов экзаменов (processStudentResultsFromExcel)

### Валидации:

#### 3.1 Валидация кода студента
- **Корректный диапазон:** 1000000000 - 9999999999 (10 цифр)
- **Неверные коды:** Возвращаются в `validationErrors.invalidStudentCodes`

#### 3.2 Валидация кода учителя
- **Извлечение:** Первые 7 цифр из кода студента (studentCode / 1000)
- **Проверка:** Существует ли учитель с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidTeacherCodes`

#### 3.3 Валидация кода школы
- **Извлечение:** Из кода учителя (teacherCode / 100)
- **Проверка:** Существует ли школа с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidSchoolCodes`

#### 3.4 Валидация кода района
- **Извлечение:** Из кода школы (schoolCode / 100)
- **Проверка:** Существует ли район с таким кодом в базе
- **Неверные коды:** Возвращаются в `validationErrors.invalidDistrictCodes`

#### 3.5 Валидация корректности баллов
- **Проверка:** `totalScore === az + math + lifeKnowledge + logic + english`
- **Неверные записи:** Возвращаются в `studentsWithIncorrectResults`

### Дополнительные поля:

#### studentsWithoutTeacher
Студенты, для которых не найден учитель в системе (не смогли автоматически присвоить)

#### studentsWithIncorrectResults
Студенты с неправильной суммой баллов:

```json
[
    {
        "studentCode": 1234567890,
        "totalScore": 100,
        "calculatedTotal": 95,
        "az": 25,
        "math": 30,
        "lifeKnowledge": 20,
        "logic": 20,
        "english": 0
    }
]
```

### Пример ответа:

```json
{
    "processedData": [...],
    "results": {...},
    "studentsWithoutTeacher": [1234567890, 9876543210],
    "studentsWithIncorrectResults": [
        {
            "studentCode": 1234567890,
            "totalScore": 100,
            "calculatedTotal": 95,
            "az": 25,
            "math": 30,
            "lifeKnowledge": 20,
            "logic": 20,
            "english": 0
        }
    ],
    "validationErrors": {
        "invalidStudentCodes": [123456789],
        "invalidTeacherCodes": [1234567],
        "invalidSchoolCodes": [12345],
        "invalidDistrictCodes": [123]
    }
}
```

## Иерархия кодов

```
Район (District)     - 3 цифры:  123
    ↓
Школа (School)       - 5 цифр:  12345
    ↓
Учитель (Teacher)    - 7 цифр:  1234567
    ↓
Студент (Student)    - 10 цифр: 1234567890
```

### Извлечение кодов:

```javascript
// Из кода студента
const teacherCode = Math.floor(studentCode / 1000);      // 1234567890 → 1234567

// Из кода учителя
const schoolCode = Math.floor(teacherCode / 100);        // 1234567 → 12345

// Из кода школы
const districtCode = Math.floor(schoolCode / 100);       // 12345 → 123
```

## Обработка ошибок на фронтенде

### Рекомендуемый подход:

1. **Показать общую статистику:**
   - Успешно обработано: `processedData.length`
   - Пропущено (дубликаты): `skippedItems.length`
   - Ошибки: `errors.length`

2. **Показать проблемные коды:**
   - Неверные коды районов: `validationErrors.invalidDistrictCodes`
   - Неверные коды школ: `validationErrors.invalidSchoolCodes`
   - Неверные коды учителей: `validationErrors.invalidTeacherCodes`
   - Неверные коды студентов: `validationErrors.invalidStudentCodes`

3. **Для результатов экзаменов дополнительно:**
   - Студенты без учителя: `studentsWithoutTeacher`
   - Студенты с неправильными баллами: `studentsWithIncorrectResults`

### Пример UI:

```
✅ Успешно загружено: 450 записей
⚠️ Пропущено (дубликаты): 20 записей
❌ Найдены проблемные записи:

Неверные коды районов (5):
123, 456, 789, 101, 102

Неверные коды школ (8):
12345, 23456, 34567, ...

Неверные коды учителей (12):
1234567, 2345678, 3456789, ...

Студенты с неправильной суммой баллов (3):
- Код: 1234567890, Указано: 100, Рассчитано: 95
- Код: 9876543210, Указано: 85, Рассчитано: 90
- Код: 5555555555, Указано: 70, Рассчитано: 68
```

## Рекомендации для операторов

1. **Перед загрузкой проверяйте:**
   - Все коды имеют правильную длину
   - Районы, школы, учителя уже существуют в системе
   - Для результатов экзаменов: сумма баллов совпадает с расчетной

2. **После загрузки анализируйте:**
   - Проверьте `validationErrors` на наличие проблемных кодов
   - Исправьте данные в Excel и загрузите повторно
   - Сначала загрузите районы, потом школы, потом учителей, потом результаты

3. **Порядок загрузки данных:**
   1. Районы (Districts)
   2. Школы (Schools)
   3. Учителя (Teachers)
   4. Результаты экзаменов (Student Results)
