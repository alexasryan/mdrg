# Nexus Messenger

Сайт: https://alexasryan.github.io/mdrg/

React + TypeScript + Supabase: учетные записи, переписка, приватные вложения и WebRTC-сигнализация между устройствами. Производственная сборка подключена к отдельному Supabase `mdrg`; скрытого перехода на localStorage при ошибке сервера нет. Демо включается только явным `VITE_DEMO=true` для локального тестирования.

## Разработка

Node.js 22.12+ (рекомендуется 24).

```sh
npm ci
npm run dev
npm run check
npx playwright install --with-deps chromium
npm run test:browser
```

Исходный HTML — `site/index.html`, приложение — `src/`, миграции — `supabase/migrations/`. `supabase.public.json` содержит только публичный URL и publishable key. Переменные из `.env.example` позволяют подключить другое окружение. Service-role key в браузере не используется.

## Публикация

Ветка: `nexus-messenger-web-app-164dd`. Workflow `.github/workflows/pages.yml` собирает и проверяет `dist`, публикует его через Pages и проверяет опубликованные HTML, ресурсы и авторизацию. Маршруты используют hash, например `/mdrg/#/settings`, поэтому refresh работает на GitHub Pages.

Корневые HTML/`assets` — сгенерированный совместимый снимок для прежнего режима Pages из ветки. Обновляйте только через `npm run pages:sync` после сборки. Режим Actions публикует `dist` напрямую.

## Эксплуатация

[Обязательные настройки почты, ограничения звонков и проверки](docs/OPERATIONS.md).

Для подтверждения почты и восстановления пароля нужно разрешить URL сайта в Supabase Auth и настроить SMTP. Звонки по решению владельца запускаются без TURN и могут быть недоступны в отдельных сетях. В серверном режиме участники звонка входят в аккаунт. Тестовые локальные аккаунты `anna@demo.local` / `ivan@demo.local` в реальном сервисе не существуют.
