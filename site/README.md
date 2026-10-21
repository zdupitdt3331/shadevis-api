# ShadeVisuals — сайт

Статический одностраничник, без сборки и зависимостей.

## Файлы

- `index.html` — разметка
- `styles.css` — стили (тёмная тема, акцент #7C5CFF)
- `script.js` — появление блоков при скролле, аккордеон FAQ
- `assets/logo.png`, `assets/hero.png` — картинки

## Локальный просмотр

Открыть `index.html` в браузере — или поднять локальный сервер:

```
python -m http.server 8080
```

## Публикация

Подойдёт любой статический хостинг: GitHub Pages, Cloudflare Pages, Netlify, Vercel.
Достаточно залить папку целиком.

## Что поменять

- Ссылки на бота: `https://t.me/ShadeVisualsPrivat_bot` (в шапке, hero, CTA, подвале).
- Тексты в секциях `#features`, `#install`, `#faq`.
- Цвета — переменные в начале `styles.css` (`--accent`, `--bg`).
