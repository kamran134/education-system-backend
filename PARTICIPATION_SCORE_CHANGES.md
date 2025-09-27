# Изменения в системе подсчета participationScore и developmentScore

## Описание изменений

В рамках обновления модели `IStudentResult` было добавлено:
1. Автоматическое вычисление поля `participationScore` при загрузке результатов из Excel
2. Логика управления `maxLevel` у студентов и вычисления `developmentScore`

## Новые файлы

### `src/types/participation.types.ts`
- **ParticipationLevel enum**: Определяет доступные уровни участия (E, D, C, B, A, Lisey)
- **ParticipationScoreMap**: Карта соответствия уровней баллам:
  - E = 1 балл
  - D = 2 балла
  - C = 3 балла
  - B = 4 балла
  - A = 5 баллов
  - Lisey = 6 баллов
- **calculateParticipationScore()**: Функция для вычисления баллов участия на основе уровня

## Обновленные файлы

### `src/models/student.model.ts`
- Обновлен интерфейс `IStudentInput` - добавлено опциональное поле `maxLevel?: number`

### `src/models/studentResult.model.ts`
- Обновлен интерфейс `IStudentResultInput` - добавлены обязательные поля:
  - `participationScore: number`
  - `score: number` 
  - `month: number`
  - `year: number`

### `src/services/studentResult.service.ts`
- Добавлен импорт функции `calculateParticipationScore`
- Обновлена функция `processStudentResultsFromExcel()`:
  - Автоматически получает месяц и год из даты экзамена
  - Вычисляет `participationScore` на основе поля `level` из Excel файла
  - **НОВОЕ**: Управляет `maxLevel` у студентов и вычисляет `developmentScore`

## Новая логика работы с maxLevel и developmentScore

### Для новых студентов:
- При создании нового студента его `maxLevel` устанавливается равным `calculateParticipationScore(level)` из Excel

### Для существующих студентов:
1. Сравнивается текущий `level` из Excel с `maxLevel` студента в базе данных
2. Если `calculateParticipationScore(currentLevel) > maxLevel`:
   - `developmentScore = 10` (развивающийся студент)
   - `maxLevel` обновляется до нового значения
3. Если `calculateParticipationScore(currentLevel) <= maxLevel`:
   - `developmentScore = 0`
   - `maxLevel` остается без изменений

## Как это работает

При загрузке результатов из Excel файла:

1. Система считывает данные из файла, включая поле `level`
2. Для каждого результата:
   - Вычисляется `participationScore` на основе значения `level`
   - Проверяется, является ли студент новым или существующим
   - **Для новых студентов**: устанавливается `maxLevel = calculateParticipationScore(level)`
   - **Для существующих студентов**: сравнивается текущий уровень с `maxLevel` и вычисляется `developmentScore`
3. Обновляются данные студентов в базе (если требуется)
4. Сохраняются результаты экзаменов с правильным `developmentScore`

## Пример работы

**Сценарий 1 - Новый студент:**
- Студент с кодом 1234567890 не найден в базе
- Уровень в Excel: "A" 
- Создается студент с `maxLevel = 5`
- `developmentScore = 0` (для нового студента)

**Сценарий 2 - Развитие существующего студента:**
- Студент в базе имеет `maxLevel = 3` (уровень C)
- Уровень в Excel: "A" (= 5 баллов)
- Поскольку 5 > 3: `developmentScore = 10`, `maxLevel` обновляется до 5

**Сценарий 3 - Студент без развития:**
- Студент в базе имеет `maxLevel = 5` 
- Уровень в Excel: "B" (= 4 балла)
- Поскольку 4 <= 5: `developmentScore = 0`, `maxLevel` остается 5

## Применение

Данные изменения вступают в силу при следующей загрузке Excel файлов через API endpoint для создания результатов студентов.