# Accounting (Railway-ready)

## Start locally
1. `npm install`
2. Заповни `.env` за зразком `.env.example`
3. `npm start`

## Деплой на Railway
- Стартова команда: `node server/app.js`
- Змінні середовища: `DATABASE_URL` (від Railway Postgres), опційно `PORT`
- Порт: автоматично бере `process.env.PORT || 3000`

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
