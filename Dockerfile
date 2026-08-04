# Базовый образ
# Node 18 не умеет require() ESM-пакеты (kysely — "type": "module", только ESM-сборка) —
# CommonJS-компилированный dist/ падает с ERR_REQUIRE_ESM. require(esm) появился
# в Node 22.12 и включён по умолчанию — поднимаем базовый образ.
FROM node:22

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы проекта
COPY package.json package-lock.json ./
RUN npm install --omit-dev

# Копируем весь код
COPY . .

# Собираем TypeScript-код
RUN npm run build

# Указываем порт и команду запуска
EXPOSE 4000
CMD ["node", "dist/index.js"]