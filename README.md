# ShadeVisuals API — деплой на Render

## Что внутри
- `server.js` — сайт + API (аккаунты, HWID, профиль, поддержка)
- `store.js` — хранилище: PostgreSQL (Render) / MySQL / JSON
- `site/` — статика (лендинг + профиль)
- `render.yaml` — Blueprint: веб-сервис + бесплатная база Postgres
- `schema.postgres.sql` — схема (сервер создаёт таблицы сам при старте)

## Шаги
1. Залей содержимое этой папки в GitHub-репозиторий (можно приватный).
2. Render → New → **Blueprint** → выбери репозиторий.
3. Render прочитает `render.yaml`, создаст:
   - `shadevis-api` (Node, free)
   - `shadevis-db` (Postgres, free)
   и сам подставит `DATABASE_URL`.
4. Дождись деплоя, открой `https://<имя>.onrender.com/api/launcher` — должно вернуться
   `{"backend":"postgres", ...}`.
5. В лаунчере: `%APPDATA%\ShadeVis\site.json` → `{"Url": "https://<имя>.onrender.com"}`.
6. В апдейтере: `config.json` → `manifestUrl` на адрес манифеста (файлы можно держать в GitHub Releases).

## Ограничения free-плана
- Сервис засыпает после ~15 минут простоя, первый запрос будет медленным (~30 с).
- Postgres free: лимит по объёму, база удаляется при долгом неиспользовании (Render предупреждает).
- Диск эфемерный — поэтому данные только в Postgres, JSON-файл для localhost-тестов.
