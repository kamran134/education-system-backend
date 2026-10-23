# Карта API

Состояние на 23.10.2026. Источник: `src/index.ts`, `src/routes/*.routes.ts`, `src/middleware/auth.middleware.ts`, контроллеры. Карта собрана по коду; при добавлении маршрута допишите его сюда.

Область данных внутри разрешённой роли дополнительно сужается по привязке пользователя (role-скоупинг, см. [../03-architecture.md](../03-architecture.md#role-скоупинг--граница-безопасности)).

Обозначения в колонке «Доступ»:
- **public** — без авторизации
- **ANY** — любой валидный JWT, роль не проверяется (в т.ч. `student`)
- **A** = `superadmin`, `admin`
- **AM** = `superadmin`, `admin`, `moderator`
- **SA** = только `superadmin`
- «+контроллер: …» — дополнительная проверка внутри метода

Сокращения контроллеров: `district::getDistricts` = `controllers/district.controller.ts`, экспорт `getDistricts`.

## Старт и инфраструктура (`src/index.ts`)

**Порядок middleware:** `helmet` -> `morgan("dev")` (не в production) -> `cors` -> `express.json` (limit 100mb) -> `express.urlencoded` (100mb) -> `cookieParser` -> `trackActivity` на `/api` (обновляет `users.last_seen_at`, не блокирует) -> `/uploads` фильтр -> `/uploads` статика -> `GET /api/achievement-files/:id/content` -> `generalLimiter` -> `GET /` -> роуты -> 404 `{message:'Məlumat tapılmadı'}` -> `errorHandler`.

- `trust proxy = 1`. `PORT` из env, по умолчанию 5000.
- **CORS:** `origin` = `CORS_ORIGINS` (через запятую) или `localhost:4200`, `localhost:5173`, `https://isim.kpm.az`, `https://newisim.kpm.az`; `credentials: true`; `exposedHeaders: ["Content-Disposition"]`.
- **Лимиты тела:** json и urlencoded по 100mb. Multer в роутах: 50 MB (certificates: 10 MB, memoryStorage).
- **Rate limit:** `generalLimiter` 100 запросов/мин на анонимный IP; пропускается, если есть `Authorization: Bearer` с валидной подписью JWT (срок игнорируется). `authLimiter` (200 за 15 мин, успешные не считаются, пропускает `/refresh`, `/me`, `/logout`, `/logout-all`, `/sessions`) навешан только на `/api/auth`. Внутри `auth.routes.ts` на `/login` ещё `loginLimiter` (10 за 15 мин, ключ IP+email).
- **Не /api эндпоинты:** `GET /` -> `"API is running!"` (public); отдельного `/health` нет.
- **Статика:** `/uploads/*` -> `<корень>/uploads`, **без авторизации** (аватары `uploads/<entity>/avatars/` и т.д.). Префикс `/uploads/achievements...` закрыт фильтром (404) после `decodeURIComponent`+`normalize`; файлы «Uğurlar» отдаются только по HMAC-ссылке.
- **Выдача файла Uğurlar:** `GET /api/achievement-files/:id/content` — смонтирован прямо в `index.ts` до `generalLimiter`, public, авторизация = HMAC-подпись в query (`v`,`d`,`exp`,`sig`), проверка в `achievementFile::serveAchievementFileContent`.
- **Перед `listen`:** `startTokenCleanupScheduler()` (синхронно, на module load, до всего); затем `loadLevelScaleBandsCache()` (фатально: ошибка -> `process.exit(1)`); `academicYearClosureServicePg.setFinalRecompute(updateAllStats)` и `ensureFinishedYearsClosed()` (автозакрытие завершённых учебных годов, не фатально, ошибка только логируется); после этого `app.listen`. В production `console.log/debug/info/warn` заглушены (кроме `[LOGIN]`, `[REFRESH TOKEN]`), `morgan` отключён.

## Префиксы монтирования

| Префикс | Файл | Доп. middleware при монтировании |
|---|---|---|
| `/api/districts` | district.routes.ts | — |
| `/api/regions` | region.routes.ts | — |
| `/api/schools` | school.routes.ts | — |
| `/api/teachers` | teacher.routes.ts | — |
| `/api/booklets` | booklet.routes.ts | — |
| `/api/exams` | exam.routes.ts | — |
| `/api/exam-types` | examType.routes.ts | — |
| `/api/subjects` | subject.routes.ts | — |
| `/api/level-scales` | levelScale.routes.ts | — |
| `/api/students` | student.routes.ts | — |
| `/api/student-results` | studentResult.routes.ts | — |
| `/api/exam-results` | examResults.routes.ts | — |
| `/api/stats` | stat.routes.ts | — |
| `/api/statistics` | statistics.routes.ts | — |
| `/api/users` | user.routes.ts | — |
| `/api/user-settings` | userSettings.routes.ts | — |
| `/api/academic-year` | gradePromotion.routes.ts | — |
| `/api/reference` | reference.routes.ts | — |
| `/api/certificates` | certificate.routes.ts | — |
| `/api/public` | public.routes.ts | — |
| `/api/profile-changes` | profileChange.routes.ts | — |
| `/api/metodika` | metodika.routes.ts | — |
| `/api/achievement-files` | achievementFile.routes.ts | — (+ `/:id/content` в index.ts) |
| `/api/deletions` | deletion.routes.ts | — |
| `/api/auth` | auth.routes.ts | `authLimiter` |

## Гварды (`src/middleware/auth.middleware.ts`)

Все гварды читают `Authorization: Bearer <jwt>`, проверяют подпись через `JWT_SECRET`, кладут payload в `req.user` (`userId`, `role`, `regionId?`, `districtId?`, `schoolId?`, `teacherId?`, `studentId?`). Нет заголовка -> 401 «Access token tələb olunur»; плохой токен -> 401 «Düzgün olmayan token»; роль не подошла -> 403. Данные пользователя в БД не перепроверяются: смена роли или блокировка действует после истечения access-токена (15 минут).

| Гвард | Строки | Допустимые роли |
|---|---|---|
| `authMiddleware(roles: string[] = [])` | 22-64 | Если `roles` пуст (`[]` или без аргумента) — **любая** роль с валидным JWT. Иначе ровно роли из массива. Роли не валидируются по списку: опечатка = никто не пройдёт. |
| `checkAdminRole` | 66-107 | `admin`, `superadmin` |
| `allRegisteredRoles` | 109-142 | Любая роль с валидным JWT (по факту синоним `authMiddleware([])`) |
| `canDelete` | 148-190 | `superadmin`, `admin` (moderator явно исключён; 403 «Yalnız superadmin və adminlər silmə əməliyyatı edə bilər») |

Прочие гварды в роутах:
- `requireAchievementManager` (`achievementFile.controller.ts:70`) — после `authMiddleware([])`: проверяет права на файл-загрузку (`canManageAchievementFiles`), существование сущности и лимит файлов до multer.
- `isAdminLike(role)` (`utils/avatar.util.ts`) — внутри контроллеров: `superadmin`, `admin`, `moderator`. Это не middleware, но определяет «админ-подобных» в проверках владения.

Рабочие группы ролей, которые встречаются в роутах: A = `["superadmin","admin"]`, AM = `["superadmin","admin","moderator"]`.

## /api/districts — Районы

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | district::getDistricts | Список районов; скоуп: districtRepresenter -> свой, regionRepresenter -> районы региона |
| POST | `/` | AM | district::createDistrict | Создать район |
| GET | `/filter` | ANY | district::getDistrictsForFilter | Список для фильтров (со скоупом) |
| GET | `/search` | ANY | district::getDistricts | Дубль `GET /` |
| POST | `/addAll` | A | district::processDistrictsFromExcel | Массовое создание районов (JSON/Excel-данные) |
| POST | `/update-stats` | A | district::updateDistrictsStats | Пересчёт статистики районов |
| GET | `/:id` | ANY | district::getDistrictById | Профиль района; +контроллер: 403 «Bu profilə baxmaq icazəniz yoxdur» вне скоупа |
| PUT | `/:id` | AM | district::updateDistrict | Обновить район |
| DELETE | `/:id` | canDelete (A) | district::deleteDistrict | Мягкое удаление района (каскадом вниз) |
| POST | `/:id/avatar` | ANY, multer `districtAvatarUpload.single('avatar')` | district::uploadAvatar | Загрузить фото района; +контроллер: свой район (districtRepresenter) или admin-like, иначе 403 |
| DELETE | `/:id/avatar` | ANY | district::deleteAvatar | Удалить фото; те же правила владения |
| PATCH | `/:id/profile` | ANY | district::updateProfile | Правка профиля района; +контроллер: admin-like пишет напрямую, владелец создаёт заявку на модерацию, остальным 403 |

## /api/regions — Регионы (РТИ)

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | region::getRegions | Список регионов |
| POST | `/` | AM | region::createRegion | Создать регион |
| GET | `/filter` | ANY | region::getRegionsForFilter | Список для фильтров |
| POST | `/check-codes` | AM | region::checkExistingRegionCodes | Проверка занятости кодов |
| GET | `/:id` | ANY | region::getRegionById | Профиль региона; +контроллер: 403 вне скоупа |
| PUT | `/:id` | AM | region::updateRegion | Обновить регион |
| DELETE | `/:id` | canDelete (A) | region::deleteRegion | Удалить регион (soft delete у регионов нет) |
| POST | `/:id/avatar` | ANY, multer `regionAvatarUpload` | region::uploadAvatar | Фото региона; +контроллер: свой регион или admin-like |
| DELETE | `/:id/avatar` | ANY | region::deleteAvatar | Удалить фото; те же правила |

## /api/schools — Школы

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | school::getSchools | Список школ; скоуп district/region/schoolDirector |
| POST | `/` | AM | school::createSchool | Создать школу |
| GET | `/filter` | ANY | school::getSchoolsForFilter | Для фильтров; не-admin-like видят только `active=true` |
| GET | `/search` | ANY | school::getSchools | Дубль `GET /` |
| POST | `/upload` | A, multer `upload.single("file")` (uploads/temp) | school::processSchoolsFromExcel | Импорт школ из Excel |
| POST | `/legacy-import` | A, multer | school::importLegacySchools | Импорт школ из старого формата |
| GET | `/repair` | A | school::repairSchools | Ремонт данных школ (GET с побочным эффектом) |
| DELETE | `/delete/:schoolIds` | canDelete (A) | school::deleteSchools | Массовое мягкое удаление по списку id |
| GET | `/:id` | ANY | school::getSchoolById | Профиль школы; +контроллер: 403 вне скоупа |
| PUT | `/:id` | AM | school::updateSchool | Обновить школу (каскад кода) |
| DELETE | `/:id` | canDelete (A) | school::deleteSchool | Мягкое удаление школы |
| POST | `/:id/avatar` | ANY, multer `schoolAvatarUpload` | school::uploadAvatar | Фото школы; +контроллер: своя школа или admin-like |
| DELETE | `/:id/avatar` | ANY | school::deleteAvatar | Удалить фото |
| PATCH | `/:id/profile` | ANY | school::updateProfile | Профиль школы (admin-like напрямую, владелец заявкой) |
| POST | `/update-stats` | A | school::updateSchoolsStats | Пересчёт статистики школ |

## /api/teachers — Учителя

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | teacher::getTeachers | Список учителей; скоуп region/district/schoolDirector/teacher |
| POST | `/` | AM | teacher::createTeacher | Создать учителя |
| GET | `/filter` | ANY | teacher::getTeachersForFilter | Для фильтров |
| GET | `/search` | ANY | teacher::getTeachers | Дубль `GET /` |
| POST | `/upload` | A, multer | teacher::processTeachersFromExcel | Импорт учителей из Excel |
| POST | `/legacy-import` | A, multer | teacher::importLegacyTeachers | Импорт из старого формата |
| GET | `/repair` | A | teacher::repairTeachers | Ремонт данных |
| POST | `/update-stats` | A | teacher::updateTeachersStats | Пересчёт статистики |
| DELETE | `/delete/:teacherIds` | canDelete (A) | teacher::deleteTeachers | Массовое мягкое удаление |
| GET | `/:id` | ANY | teacher::getTeacherById | Профиль; +контроллер: 403 вне скоупа |
| PUT | `/:id` | AM | teacher::updateTeacher | Обновить (смена школы -> 400) |
| DELETE | `/:id` | canDelete (A) | teacher::deleteTeacher | Мягкое удаление |
| POST | `/:id/transfer` | AM | teacher::transferTeacher | Перевод учителя в другую школу |
| POST | `/:id/avatar` | ANY, multer `teacherAvatarUpload` | teacher::uploadAvatar | Фото; +контроллер: admin-like, сам учитель, директор его школы |
| DELETE | `/:id/avatar` | ANY | teacher::deleteAvatar | Удалить фото; те же правила |
| PATCH | `/:id/profile` | ANY | teacher::updateProfile | Профиль (admin-like напрямую, владелец заявкой) |

## /api/students — Ученики

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | student::getStudents | Список; скоуп всех ролей, student — только себя |
| POST | `/` | AM | student::createStudent | Создать ученика |
| DELETE | `/` | canDelete (A) | student::deleteAllStudents | Мёртвый маршрут: контроллер всегда отвечает 403 |
| GET | `/repair` | A | student::repairStudents | Ремонт данных |
| POST | `/legacy-import` | A, multer | student::importLegacyStudents | Импорт из старого формата |
| GET | `/search/:searchString` | ANY | student::searchStudents | Поиск по строке |
| DELETE | `/delete/:studentIds` | canDelete (A) | student::deleteStudents | Массовое мягкое удаление |
| GET | `/:id` | ANY | student::getStudent | Карточка; +контроллер: 403 вне скоупа |
| PUT | `/:id` | AM | student::updateStudent | Обновить ученика |
| DELETE | `/:id` | canDelete (A) | student::deleteStudent | Мягкое удаление |
| PATCH | `/:id/profile` | ANY | student::updateProfile | Правка ФИО: admin-like напрямую, учитель этого ученика заявкой (`canRequestStudentProfileChange`), директор не допущен |
| POST | `/:id/avatar` | ANY, multer `avatarUpload` | student::uploadStudentAvatar | Фото; +контроллер `canManageStudentAvatar`: admin-like, учитель ученика, директор его школы |
| DELETE | `/:id/avatar` | ANY | student::deleteStudentAvatar | Удалить фото; те же правила |
| POST | `/bulk-upload/avatars` | A, multer `bulkAvatarUpload.array('avatars',500)` | student::bulkUploadAvatars | Массовая загрузка фото |

## /api/booklets — Буклеты

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | booklet::getBooklets | Список буклетов |
| POST | `/` | AM | booklet::createBooklet | Создать буклет |
| POST | `/upload` | AM, multer | booklet::uploadBooklets | Импорт буклетов из файла |
| GET | `/public/:id` | **public** | booklet::getBookletById | Буклет по id без авторизации |
| GET | `/:id` | ANY | booklet::getBookletById | Буклет по id |
| PUT | `/:id` | AM | booklet::updateBooklet | Обновить |
| DELETE | `/:id` | canDelete (A) | booklet::deleteBooklet | Удалить |

## /api/exams — Экзамены

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | exam::getExams | Список экзаменов |
| POST | `/` | AM | exam::createExam | Создать экзамен |
| DELETE | `/` | canDelete (A) | exam::deleteAllExams (= deleteExams, `ids` из body) | Удалить экзамены по списку id из тела |
| PUT | `/:id` | **SA** | exam::updateExam | Обновить экзамен (тип и дата блокируются при наличии результатов, 409) |
| DELETE | `/:id` | canDelete (A) | exam::deleteExam | Удалить экзамен |
| GET | `/filter` | ANY | exam::getExamsForFilter | Список для фильтров |
| GET | `/:id/results-template.xlsx` | A | exam::getResultsTemplate | Скачать .xlsx-шаблон результатов (`?grade=N`) |

## /api/exam-types — Типы экзаменов

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | examType::getExamTypes | Список типов |
| POST | `/` | A | examType::createExamType | Создать тип (валидация секций в контроллере) |
| GET | `/:id/results-template.xlsx` | ANY | examType::getResultsTemplateForSection | Скачать .xlsx-шаблон по типу (`?sectionId=`) |
| PUT | `/:id` | A | examType::updateExamType | Обновить тип и секции |
| DELETE | `/:id` | A (`authMiddleware`, не `canDelete`) | examType::deleteExamType | Удалить тип |

## /api/subjects — Предметы

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | subject::getSubjects | Справочник предметов |
| POST | `/` | A | subject::createSubject | Создать предмет |
| PUT | `/:code` | A | subject::updateSubject | Обновить предмет по коду |

## /api/level-scales — Шкалы уровней

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | levelScale::getLevelScales | Список шкал pillə (только чтение) |

## /api/student-results — Результаты учеников

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | studentResult::getStudentResults | Список результатов (скоуп внутри сервиса/контроллера) |
| POST | `/upload` | A, multer (uploads/temp, 50 MB) | studentResult::createAllResults (processStudentResultsFromExcel) | Импорт результатов из Excel (одна транзакция) |
| PUT | `/:id` | AM | studentResult::updateStudentResult | Изменить результат |
| DELETE | `/:id` | canDelete (A) | studentResult::deleteStudentResult | Удалить результат |
| DELETE | `/exam/:examId` | A | studentResult::deleteResults | Удалить все результаты экзамена |

## /api/exam-results — Результаты экзаменов (чтение)

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY (`authMiddleware()`) | examResults::getExamResults | Результаты с фильтрами и пагинацией; скоуп teacher/schoolDirector/district/region/student (examResults.controller.ts:43-51) |
| GET | `/:id` | ANY | examResults::getExamResultById | Один результат; проверка владения внутри (`:99-118`), чужой — как «не найдено» |

## /api/stats — Рейтинги (статистика по сущностям)

Все GET скоупятся ролью внутри `stat.controller.ts` (district/school/teacher/student/region).

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| POST | `/` | A | stat::updateStatistics | Пересчёт статистики (по параметрам) |
| POST | `/all` | A | stat::updateAllStatistics | Полный пересчёт |
| GET | `/students` | ANY | stat::getStudentsStatistics | Рейтинг учеников |
| GET | `/students/developing` | ANY | stat::getDevelopingStudents | İnkişaf — прогресс учеников |
| GET | `/students/month` | ANY | stat::getStudentsOfMonth | Ученики месяца |
| GET | `/students/month-republic` | ANY | stat::getStudentsOfMonthByRepublic | Ученики месяца по республике |
| GET | `/by-exam/:examId` | ANY | stat::getStatisticsByExam | Статистика по экзамену |
| GET | `/teachers` | ANY | stat::getTeacherStatistics | Рейтинг учителей |
| GET | `/schools` | ANY | stat::getSchoolStatistics | Рейтинг школ |
| GET | `/districts` | ANY | stat::getDistrictStatistics | Рейтинг районов |
| GET | `/regions` | ANY | stat::getRegionStatistics | Рейтинг регионов |

## /api/statistics — Аналитика (годовая/помесячная)

Роутер: `router.use(authMiddleware())` — всё ANY; скоуп в `statistics.controller.ts::applyRbacFilters` (админы видят всё).

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY | statistics::getStatistics | Полная статистика (год + месяцы) |
| GET | `/yearly` | ANY | statistics::getYearlyStatistics | Годовая |
| GET | `/monthly` | ANY | statistics::getMonthlyStatistics | Помесячная |
| GET | `/inkishaf` | ANY | statistics::getInkishafStatistics | İnkişaf по минимуму участий |

## /api/users — Пользователи (админка)

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | checkAdminRole | user::getUsers | Список пользователей |
| POST | `/` | checkAdminRole | user::createUser | Создать пользователя; +контроллер: admin не может создать superadmin (403), проверки привязки (regionId/districtId/schoolId/teacherId/studentId) |
| PUT | `/` | checkAdminRole | user::updateUser | Обновить (id в теле); +контроллер: superadmin не редактируется другими, роль superadmin не выдаётся не-superadmin (403) |
| GET | `/activity-stats` | checkAdminRole | user::getActivityStats | Статистика входов/онлайн |
| GET | `/activity-stats/users` | checkAdminRole | user::getActivityUsers | Пользователи по активности |
| DELETE | `/:id` | canDelete (A) | user::deleteUser | Удалить пользователя; +контроллер: superadmin не удаляется (403) |
| PUT | `/:id/password` | checkAdminRole | user::changePassword | Сменить пароль пользователю |

## /api/user-settings — Настройки колонок

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/global` | allRegisteredRoles (ANY) | userSettings::getGlobalSettings | Глобальные настройки колонок по ролям |
| PUT | `/global` | A (`authMiddleware(['admin','superadmin'])`) | userSettings::updateGlobalSettings | Обновить глобальные настройки |
| GET | `/` | allRegisteredRoles (ANY) | userSettings::getUserSettings | Настройки колонок пользователя |
| PUT | `/` | allRegisteredRoles (ANY) | userSettings::updateUserSettings | Сохранить настройки колонок |

## /api/academic-year — Учебный год

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/promotion` | A | gradePromotion::previewGradePromotion | Предпросмотр перевода классов |
| POST | `/promotion` | A | gradePromotion::executeGradePromotion | Выполнить перевод классов (409 пока год не закрыт) |
| GET | `/closure` | A | gradePromotion::previewClosure | Предпросмотр закрытия года |
| POST | `/closure` | A | gradePromotion::executeClosure | Закрыть учебный год (пломба + чексуммы) |
| PUT | `/rating-year` | A | gradePromotion::putRatingYear | Тумблер «Yeni tədris ili» (показ нового года рейтингов) |

## /api/reference — Справочники

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/levels` | ANY | reference::getLevelsReference | Справочник уровней pillə |
| GET | `/subjects` | ANY | reference::getSubjectsReference | Справочник предметов |
| GET | `/rating-year` | ANY | reference::getRatingYearReference | Текущий активный год рейтингов |

## /api/certificates — Сертификаты

Multer: `memoryStorage`, лимит 10 MB, `authMiddleware` стоит перед `upload.single("image")`. `ADMIN_ROLES` = A.

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/templates` | A | certificate::listTemplates | Список шаблонов |
| POST | `/templates` | A, multer image | certificate::createTemplate | Создать шаблон с фоном |
| GET | `/templates/default-layout` | A | certificate::getDefaultLayout | Раскладка по умолчанию |
| GET | `/templates/:id` | A | certificate::getTemplate | Один шаблон |
| PUT | `/templates/:id` | A | certificate::updateTemplate | Обновить шаблон |
| DELETE | `/templates/:id` | A | certificate::deleteTemplate | Удалить шаблон |
| POST | `/templates/:id/image` | A, multer image | certificate::replaceTemplateImage | Заменить фон |
| POST | `/templates/:id/female-image` | A, multer image | certificate::replaceTemplateFemaleImage | Загрузить женский фон |
| DELETE | `/templates/:id/female-image` | A | certificate::removeTemplateFemaleImage | Убрать женский фон |
| POST | `/templates/:id/preview` | A | certificate::previewTemplate | Превью PDF (скачивание файла) |
| GET | `/templates/:id/layout-from/:sourceId` | A | certificate::getLayoutFrom | Раскладка из другого шаблона, без сохранения |
| GET | `/issued` | A | certificate::listIssued | Выданные сертификаты |
| POST | `/issued/:id/revoke` | A | certificate::revokeIssued | Отозвать сертификат |
| DELETE | `/issued/:id` | A | certificate::deleteIssued | Удалить снапшот выдачи |
| DELETE | `/templates/:id/issued` | A | certificate::deleteIssuedByTemplate | Сбросить все снапшоты шаблона |
| GET | `/result/:studentResultId/:awardCode` | ANY | certificate::downloadForResult | Выдать (при первом скачивании) и скачать PDF сертификата |
| GET | `/availability/student/:studentId` | ANY | certificate::availabilityForStudent | Какие сертификаты доступны ученику |

## /api/public — Публичное

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/summary` | **public** | public::getSummary | Агрегированные счётчики для лендинга |
| GET | `/certificates/:token` | **public**, `verifyLimiter` (30 за 5 мин) | certificate::verifyByToken | Проверка сертификата по QR-токену |

## /api/profile-changes — Заявки на правку профилей

Роутер даёт только «авторизован»; админ-проверка внутри контроллера (`isAdminLike`).

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | ANY +контроллер: admin-like (иначе 403) | profileChange::listQueue | Очередь заявок |
| GET | `/count` | ANY +контроллер: admin-like | profileChange::count | Число ожидающих заявок |
| GET | `/pending-ids` | ANY +контроллер: admin-like | profileChange::pendingIds | id сущностей с заявкой |
| GET | `/current` | ANY +контроллер: admin-like или владелец сущности | profileChange::current | Текущая заявка по сущности |
| POST | `/:id/approve` | ANY +контроллер: admin-like | profileChange::approve | Одобрить заявку |
| POST | `/:id/reject` | ANY +контроллер: admin-like | profileChange::reject | Отклонить заявку |

## /api/metodika — Методика

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | **public** | metodika::get | Страница «İSİM metodikası» |
| PUT | `/` | A | metodika::put | Сохранить содержимое |
| DELETE | `/` | A | metodika::delete | Сбросить содержимое |

## /api/achievement-files — Файлы «Uğurlar»

Порядок на загрузке: `authMiddleware([])` -> `requireAchievementManager` -> multer `uploadAchievementFile`. Права: admin-like — «admin»-доступ (сразу публикуется, 201); учитель на свой профиль, директор на свою школу — «owner» (заявка на модерацию, 202). `entityType` — teacher/school.

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| POST | `/:id/cancel-removal` | ANY +контроллер: `accessForFile` (admin-like или владелец), иначе 403 | achievementFile::cancelRemoval | Отменить запрос на удаление файла |
| GET | `/:entityType/:entityId` | ANY | achievementFile::list | Список файлов профиля, ссылки подписаны HMAC; `canManage` в ответе |
| POST | `/:entityType/:entityId` | ANY, `requireAchievementManager` (403/404/409), multer | achievementFile::upload | Загрузка файла (лимит файлов на сущность) |
| DELETE | `/:id` | ANY +контроллер: `accessForFile` | achievementFile::remove | Удалить файл (владелец — через модерацию, 202) |
| GET | `/:id/content` (**index.ts:123**) | **public**, HMAC в query | achievementFile::content | Отдача файла/превью по подписанной ссылке |

## /api/deletions — Журнал удалений («Silinənlər»)

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/` | A (`authMiddleware(["admin","superadmin"])`) | deletion::listDeletionBatches | Список удалённых пачек (`?type=&search=&page=&size=`) |
| POST | `/:id/restore` | A | deletion::restoreDeletionBatch | Восстановить пачку (409, если родитель ещё скрыт) |

## /api/auth — Аутентификация

Весь роутер за `authLimiter` (index.ts:199).

| Метод | Путь | Доступ | Контроллер::метод | Что делает |
|---|---|---|---|---|
| GET | `/check-role/:id` | **public** | auth::checkRole | Роль пользователя по id |
| POST | `/login` | **public**, `loginLimiter` | auth::login | Вход; требует `isApproved`; refresh в httpOnly cookie |
| POST | `/register` | **public** | auth::register | Регистрация: всегда неодобренный `student`, `role` из тела игнорируется |
| POST | `/approve/:id` | A | auth::approveUser | Подтвердить пользователя |
| POST | `/logout` | **public** (по cookie refreshToken) | auth::logout | Выход из сессии |
| POST | `/logout-all` | ANY | auth::logoutFromAllDevices | Выход со всех устройств |
| POST | `/refresh` | **public** (по cookie refreshToken) | auth::refreshToken | Обновить access-токен |
| GET | `/me` | ANY | auth::me | Текущий пользователь и профиль |
| PUT | `/change-password` | ANY | auth::changeOwnPassword | Смена собственного пароля |
| GET | `/sessions` | ANY | auth::getActiveSessions | Активные сессии |
| GET | `/debug-cookies` | **SA** | inline (auth.routes.ts:31) | Отладочный дамп cookies |
| GET | `/admin/token-stats` | A | auth::getTokenStatistics | Статистика токенов |
| POST | `/admin/cleanup-tokens` | A | auth::forceCleanupTokens | Принудительная очистка токенов |

## Итог по числу маршрутов

- В `src/routes/*.routes.ts`: **178** (метод+путь).
- Дополнительно в `index.ts`: `GET /api/achievement-files/:id/content`, `GET /`, статика `/uploads/*` (не считаются в 178).

## Замечания

- Дубли: `GET /search` повторяет `GET /` с тем же обработчиком у районов, школ и учителей.
- `DELETE /api/students/` — мёртвый маршрут, контроллер всегда отвечает 403. `DELETE /api/exams/` удаляет экзамены по списку `ids` из тела, несмотря на имя `deleteAllExams`.
- Роли на экзаменах несогласованы: создать может AM, изменить — только superadmin, шаблон результатов экзамена — A, шаблон по типу — любой авторизованный.
- «Только админ» записан тремя способами (`checkAdminRole`, `authMiddleware(["superadmin","admin"])`, `canDelete`) с разными текстами 403; часть удалений защищена не `canDelete`, а `authMiddleware(A)`.
- Порядок объявления: статические пути должны стоять до `/:id`. Сейчас нигде не ломается, но в `exam.routes.ts` и `school.routes.ts` держится на том, что у `/:id` нет того же HTTP-метода.
- `GET /repair` у школ, учителей и учеников меняет данные по `GET` (только A). `GET /api/auth/debug-cookies` (SA) — отладочный эндпоинт в production-коде.
