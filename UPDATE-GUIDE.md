# Как выпускать обновления лаунчера

## 1. Собрать новую версию

```powershell
tools\Build.ps1 -Configuration Release      # лаунчер
tools\BuildBootstrap.ps1                    # один exe (если раздаёшь одним файлом)
tools\PublishUpdate.ps1 -Version 0.0.53     # zip + latest.json + sha256
```

Результат: `dist\update\ShadeVisuals-0.0.53.zip` и `dist\update\latest.json`.

## 2. Выложить zip

GitHub → репозиторий `shadevis-api` → **Releases** → **Draft a new release**:

- Tag: `v0.0.53`
- Прикрепи файл `ShadeVisuals-0.0.53.zip`
- Publish release

Скопируй ссылку на ассет (правый клик по файлу → Copy link address), она выглядит так:

```
https://github.com/zdupitdt3331/shadevis-api/releases/download/v0.0.53/ShadeVisuals-0.0.53.zip
```

## 3. Обновить манифест

В репозитории открой/создай `site/latest.json` (он отдаётся по адресу `https://shadevis-api.onrender.com/latest.json`) и вставь:

```json
{
  "version": "0.0.53",
  "url": "https://github.com/zdupitdt3331/shadevis-api/releases/download/v0.0.53/ShadeVisuals-0.0.53.zip",
  "sha256": "<из PublishUpdate.ps1>",
  "notes": "- что нового в этой версии"
}
```

Commit → Render передеплоит. Апдейтер у всех уже настроен на
`https://shadevis-api.onrender.com/latest.json`.

## 4. Что увидят игроки

При запуске лаунчер поднимает `ShadeUpdater.exe --check`, тот читает манифест,
сравнивает с `version.dat` и показывает окно «Доступно обновление» → скачивание
с прогрессом → проверка SHA-256 → распаковка в папку лаунчера → перезапуск.

## Важно

- `version` в манифесте должна быть новее установленной, иначе окна не будет.
- `sha256` обязателен: при несовпадении апдейтер отменит установку.
- Не удаляй старые релизы, если на них ещё ссылается манифест.
