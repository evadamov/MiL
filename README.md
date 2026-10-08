# MiL — приложение для бизнес-воркшопов

Ведущий показывает вводные и результаты ходов, команды делают ходы со своих
устройств, движок считает. Сценарий воркшопа — Markdown или JSON в
`scenarios/`, код его не знает.

- [docs/spec.md](docs/spec.md) — приложение
- [docs/engine.md](docs/engine.md), [docs/mechanics.md](docs/mechanics.md) — движок
- [docs/scenario-format.md](docs/scenario-format.md) — формат сценария
- [scenarios/](scenarios/) — «Малыш и лимонад», «Чай на катке»

## Команды

```bash
npm install                                # в корне: ставит зависимости движка и приложения
npm test                                   # тесты движка, всех сценариев и приложения
npm run sim -- validate                    # проверка всех сценариев, как при сборке
npm run sim -- validate scenarios/lemonade # один сценарий
npm run sim -- play scenarios/lemonade d2.jug=buy d14_order.prep=19
npm run sim -- export-json scenarios/rink_tea > scenario.json
```

## Приложение для воркшопа

```bash
npm run dev       # разработка: http://localhost:3000
npm run build     # сборка; перед ней проверяются все сценарии
npm run start     # рабочий запуск на своём сервере, порт 3000
```

- `/` — ведущий: выбор сценария, создание сессии → пульт
- `/s/<код>/control#k=<ключ>` — пульт; ссылка с ключом открывается при создании сессии
- `/s/<код>/screen` — проектор
- `/join` — вход команд по коду

Сессии хранятся JSON-файлами в `data/sessions/`, картинки вводных — в
`data/images/`. Переменные окружения: `MIL_DATA` — другой каталог данных,
`MIL_ROOT` — корень репозитория со `scenarios/`. Один процесс Node на
сервер: записи в сессию идут по очереди внутри процесса.
