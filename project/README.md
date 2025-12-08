# Accounting (Railway-ready)

## Start locally
1. `cp .env.example .env`
2. За потреби онови `DATABASE_URL` / `PORT` у `.env`
3. `npm install`
4. `npm run dev`

## Деплой на Railway
- Потрібен сервис Postgres; прив'язати його `DATABASE_URL` до Node-сервісу
- Стартова команда: `node server/app.js` (або `npm start`)
- Змінні середовища: `DATABASE_URL`, опційно `PORT` (Railway ставить сам)
- Порт: `process.env.PORT || 3000`

## Структура
```
project-root/
  server/
    app.js
    db.js
    routes/
    public/
  package.json
  .env.example
  README.md
```
