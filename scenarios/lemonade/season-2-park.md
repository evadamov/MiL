# phase park · Сезон 2 · Парк

Точка в парке на папин заём: кола, поиск модели, лимонад, прогноз.

### trainer

Сезон 2 — 30–36 минут. Контрольные точки: 1:00 цена лимонада выбрана,
1:15 заказ на понедельник, 1:20 Д15 раскрыт, 1:26 прогнозы.

Резерв при отставании: Д9 и Д10 одним разбором (−4 минуты), Д12 без
устного прогноза (−3). Нельзя резать Д8, вечерний заказ Д14 и Д15.

## step d7 · Воскресенье · Запуск в парке

Папа даёт в долг {{p.park.loan}} монет. На них Малыш покупает
оборудование для точки в парке — {{p.park.equipment}} — и стартовый запас
колы: {{p.park.cola_units}} бутылок по {{p.park.cola_cost}}.

После двора у Малыша было {{at.d5.cash}} монет. Место в парке стоит
{{p.park.place}} в день, лёд — {{p.park.ice}}. Торговать начнём завтра.

```sim
duration: {min: 3, max: 3}
inputs:
  - id: runway
    type: quiz
    label: Примерно на сколько дней хватит денег, если не продать ни одной бутылки?
    unit: дней
    answer: {expr: {"/": [{var: at.d7.cash}, {"+": [{var: p.park.place}, {var: p.park.ice}]}]}}
    tolerance: 0.5
    explain: "{{cash}} монет при расходах {{p.park.place}} + {{p.park.ice}} в день — примерно на четыре дня. Это запас прочности, а не прогноз."
mechanics:
  - use: financing
    params: {amount: $p.park.loan, source: dad_loan}
  - use: capex
    params: {amount: $p.park.equipment, source: park_equipment}
  - use: inventory
    id: cola
    params: {mode: stock, units: $p.park.cola_units, unit_cost: $p.park.cola_cost, source: cola_stock}
results:
  panels: [answers, facts, {statement: {kind: balance, scope: step}}]
```

### move

Посчитайте runway: деньги после запуска делим на расходы дня. Ответ — примерное число дней.

## step d8 · Понедельник · Кола

Первый день в парке. Малыш продаёт колу по {{p.park.cola_price_d8}},
закупает по {{p.park.cola_cost}}. Сколько продал, столько вечером и
докупил — запас на полке не меняется.

```sim
duration: {min: 4, max: 5}
inputs:
  - id: contribution
    type: quiz
    label: Сколько монет остаётся с одной бутылки?
    unit: монет
    answer: 2
    tolerance: 0
  - id: breakeven
    type: quiz
    label: Сколько бутылок в день нужно продать, чтобы выйти в ноль?
    unit: бутылок
    answer: 35
    tolerance: 0
    explain: "Место и лёд — 70 монет в день. 70 / 2 = 35 бутылок."
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.mon, conversion: 0.14, price: $p.park.cola_price_d8}
  - use: inventory
    id: cola
    params: {mode: sell, unit_cost: $p.park.cola_cost, restock: true, source: cola_restock}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
results:
  panels:
    - answers
    - facts
    - metrics:
        - {label: Маржа с бутылки, value: $metrics.unit_margin, format: money}
trainer: {protected: true}
```

### move

Кола по {{p.park.cola_price_d8}}, закупка {{p.park.cola_cost}}, место и лёд —
{{p.park.place}} + {{p.park.ice}} в день.

### debrief

С каждой бутылки остаётся 2 монеты — экономика одной продажи положительная.
Но день стоит 70 монет независимо от продаж, поэтому в ноль выходят только с
35 бутылок. Продали 14.

Положительная маржа одной продажи ещё не делает бизнес прибыльным.
Безубыточность считают вместе с постоянными расходами.

## step d9 · Вторник · Цена колы

Может, дело в цене? Сегодня Малыш попробует другую.

```sim
duration: {min: 2, max: 3}
inputs:
  - id: cola_price
    type: choice
    label: По какой цене продаём колу?
    options:
      - {value: 5, label: "5 монет"}
      - {value: 6, label: "6 монет"}
      - {value: 7, label: "7 монет"}
      - {value: 8, label: "8 монет"}
    default: 6
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.tue}
  - use: price_response
    params: {price: $input.cola_price, table: $p.park.cola_price_table}
  - use: inventory
    id: cola
    params: {mode: sell, unit_cost: $p.park.cola_cost, restock: true, source: cola_restock}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
variants:
  - id: cola_price
    input: d9.cola_price
    values: options
    columns:
      - {label: Продано, value: $at.d9.metrics.sold, format: int}
      - {label: Конверсия, value: $at.d9.metrics.conversion, format: percent1}
      - {label: Прибыль дня, value: $at.d9.pl.day, format: money}
```

## step d10 · Среда · Флаеры на колу

С сегодняшнего дня кола у всех по {{p.park.cola_price}}. Типография
предлагает флаеры.

```sim
duration: {min: 2, max: 3}
inputs:
  - id: flyers
    type: choice
    label: Сколько флаеров печатаем?
    options:
      - {value: 0, label: "Не печатаем"}
      - {value: 100, label: "100 за 10"}
      - {value: 300, label: "300 за 24"}
      - {value: 500, label: "500 за 30"}
    default: 0
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.wed, conversion: $p.park.cola_conversion, price: $p.park.cola_price}
  - use: channel
    params: {choice: $input.flyers, tiers: $p.flyers}
  - use: inventory
    id: cola
    params: {mode: sell, unit_cost: $p.park.cola_cost, restock: true, source: cola_restock}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
variants:
  - id: flyers
    input: d10.flyers
    values: options
    columns:
      - {label: Трафик, value: $at.d10.metrics.traffic, format: int}
      - {label: Продано, value: $at.d10.metrics.sold, format: int}
      - {label: Конверсия, value: $at.d10.metrics.conversion, format: percent1}
      - {label: Прибыль дня, value: $at.d10.pl.day, format: money}
```

### move

Флаеры: 100 за 10 монет, 300 за 24, 500 за 30.

### debrief

Вчера: больше всего бутылок продаётся по самой низкой цене, меньше всего
убыток — по цене повыше. Максимум покупателей и максимум денег — разные
точки. Но при любой цене день убыточный: дело не в цене.

Сегодня: за 24 монеты пришло 23 новых человека, купили трое и принесли 9
монет сверх закупки. Продажи выросли, прибыль упала. Флаер привёл людей,
но не тех, кому нужна кола: конверсия осталась прежней. Если смотреть
только на продажи, не видно, что канал стоит дороже, чем приносит.

## step d11 · Четверг · Discovery

Кола не работает. Сегодня Малыш не торгует: весь день он расспрашивает
людей в парке, чего им не хватает. Оказывается — домашнего лимонада.

Остаток колы соседний ларёк выкупает по закупочной цене. Место в парке
всё равно оплачено.

```sim
duration: {min: 3, max: 4}
inputs:
  - id: lemon_price
    type: choice
    label: По какой цене завтра продаём лимонад?
    options:
      - {value: 7, label: "7 монет"}
      - {value: 9, label: "9 монет"}
      - {value: 11, label: "11 монет"}
    default: 9
mechanics:
  - use: inventory
    id: cola
    params: {mode: liquidate, source: cola_selloff}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
trainer: {checkpoint: "1:00"}
```

### move

Завтра первый день лимонада. Ингредиенты — {{p.park.lemon_cost}} монеты на
стакан. Цена: 7, 9 или 11?

## step d12 · Пятница · Первый лимонад

Первый день лимонада. Малыш наливает по ходу дня.

```sim
duration: {min: 2, max: 3}
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.fri}
  - use: price_response
    params: {price: $inputs.d11.lemon_price, table: $p.park.lemon_price_table}
  - use: on_demand_production
    params: {unit_cost: $p.park.lemon_cost, source: ingredients}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
variants:
  - id: lemon_price
    input: d11.lemon_price
    values: options
    columns:
      - {label: Продано, value: $at.d12.metrics.sold, format: int}
      - {label: Конверсия, value: $at.d12.metrics.conversion, format: percent1}
      - {label: Прибыль дня, value: $at.d12.pl.day, format: money}
```

## step d13 · Суббота · Флаеры на лимонад

С сегодняшнего дня лимонад у всех по {{p.park.lemon_price}}. Типография
снова предлагает флаеры — те же тиражи, те же цены.

```sim
duration: {min: 3, max: 3}
inputs:
  - id: flyers
    type: choice
    label: Сколько флаеров печатаем?
    options:
      - {value: 0, label: "Не печатаем"}
      - {value: 100, label: "100 за 10"}
      - {value: 300, label: "300 за 24"}
      - {value: 500, label: "500 за 30"}
    default: 0
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.sat, conversion: $p.park.lemon_conversion, price: $p.park.lemon_price}
  - use: channel
    params:
      choice: $input.flyers
      tiers: $p.flyers
      conversion_by_key: {"100": 0.173, "300": 0.179, "500": 0.171}
  - use: on_demand_production
    params: {unit_cost: $p.park.lemon_cost, source: ingredients}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
variants:
  - id: flyers
    input: d13.flyers
    values: options
    columns:
      - {label: Трафик, value: $at.d13.metrics.traffic, format: int}
      - {label: Продано, value: $at.d13.metrics.sold, format: int}
      - {label: Конверсия, value: $at.d13.metrics.conversion, format: percent1}
      - {label: Прибыль дня, value: $at.d13.pl.day, format: money}
```

### move

Флаеры на лимонад: 100 за 10 монет, 300 за 24, 500 за 30.

### debrief

Четверг стоил денег: место оплачено, а выручки нет. Поиск модели после
запуска платный.

Пятница: самая низкая цена собрала больше всего покупателей, но не больше
всего денег.

Суббота: на коле флаер поднимал только трафик, конверсия стояла на месте.
Здесь он поднимает и трафик, и конверсию — предложение совпало с теми, кого
звали. Самый большой тираж упирается в насыщение: людей больше, а доля
купивших падает.

## step d14 · Воскресенье · Лучший день

Лучший день недели. С сегодняшнего дня у всех рабочая модель: лимонад по
{{p.park.lemon_price}}, {{p.park.working_flyers}} флаеров в день.

```sim
duration: {min: 2, max: 2}
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.sun, conversion: $p.park.lemon_conversion, price: $p.park.lemon_price}
  - use: channel
    params: {choice: $p.park.working_flyers, tiers: $p.flyers}
  - use: on_demand_production
    params: {unit_cost: $p.park.lemon_cost, source: ingredients}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
```

## step d14_order · Воскресенье, вечер · Заказ на понедельник

Вечером мама спрашивает: сколько стаканов заготовить на завтра? Утром она
уйдёт на работу, доливать будет некому. Продать можно только заготовленное,
а ингредиенты уйдут на весь заказ.

Завтра понедельник.

```sim
duration: {min: 2, max: 2}
inputs:
  - id: prep
    type: number
    label: Сколько стаканов заготовить на понедельник?
    unit: стаканов
    min: 0
    max: 80
    step: 1
    samples: [15, 19, 25, 30, 40, 50]
    default: 30
trainer: {checkpoint: "1:15", protected: true}
```

### move

Сколько стаканов заготовить на понедельник? Продать можно только
заготовленное.

## step d15 · Понедельник · «Прекрасный понедельник»

Мама заготовила столько, сколько вы заказали. Малыш открывает точку.

```sim
duration: {min: 3, max: 4}
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.mon, conversion: $p.park.monday_conversion, price: $p.park.lemon_price}
  - use: channel
    params: {choice: $p.park.working_flyers, tiers: $p.flyers}
  - use: batch_production
    params: {quantity: $inputs.d14_order.prep, unit_cost: $p.park.lemon_cost, source: ingredients}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
variants:
  - id: prep
    input: d14_order.prep
    values: [15, 19, 25, 30, 40, 50]
    columns:
      - {label: Продали, value: $at.d15.metrics.sold, format: int}
      - {label: Списали, value: $at.d15.metrics.waste_units, format: int}
      - {label: Прибыль дня, value: $at.d15.pl.day, format: money}
trainer: {checkpoint: "1:20", protected: true}
```

### results

Людей в парке — {{metrics.traffic}}, вдвое меньше, чем вчера. Захотели
купить {{metrics.demand}}.

### debrief

Конверсия почти та же, что вчера. Бизнес не сломался: просто в понедельник
в парке вдвое меньше людей, чем в воскресенье. Кто заказывал по
воскресенью, вылил лишнее — а ингредиенты оплачены за весь заказ.

Спрос считают по типу дня, а не по вчерашнему дню.

## step d16 · Вторник · Обычный день

Обычный будний день. Рабочая модель, ничего нового.

```sim
duration: {min: 2, max: 2}
inputs:
  - id: forecast_daily
    type: forecast
    label: Сколько Малыш зарабатывает в обычный день?
    unit: монет
mechanics:
  - use: funnel
    params: {traffic: $p.park.traffic.tue, conversion: $p.park.lemon_conversion, price: $p.park.lemon_price}
  - use: channel
    params: {choice: $p.park.working_flyers, tiers: $p.flyers}
  - use: on_demand_production
    params: {unit_cost: $p.park.lemon_cost, source: ingredients}
  - use: fixed_costs
    params: {amount: $p.park.place, source: place}
  - use: fixed_costs
    id: ice
    params: {amount: $p.park.ice, source: ice}
```

## step d16_goal · Вторник · Прогноз

Смартфон стоит {{p.goal}} монет. У Малыша {{at.d16.cash}} монет, но
{{at.d16.balance.loan}} из них — долг папе.

```sim
duration: {min: 2, max: 2}
inputs:
  - id: forecast_days
    type: forecast
    label: Через сколько дней Малыш накопит на смартфон?
    unit: дней
mechanics:
  - use: projection
    params:
      unit_price: $p.park.lemon_price
      unit_cost: $p.park.lemon_cost
      period_cost: {expr: {"+": [{var: at.d16.pl.lines.fixed_costs}, {var: at.d16.pl.lines.marketing}]}}
      periods:
        - {id: mon, label: Пн, traffic: 123, conversion: $p.park.monday_conversion}
        - {id: tue, label: Вт, traffic: 131, conversion: $p.park.lemon_conversion}
        - {id: wed, label: Ср, traffic: 131, conversion: $p.park.lemon_conversion}
        - {id: thu, label: Чт, traffic: 131, conversion: $p.park.lemon_conversion}
        - {id: fri, label: Пт, traffic: 156, conversion: $p.park.lemon_conversion}
        - {id: sat, label: Сб, traffic: 250, conversion: $p.park.lemon_conversion}
        - {id: sun, label: Вс, traffic: 313, conversion: $p.park.lemon_conversion}
      goal: $p.goal
      current: {expr: {"-": [{var: now.balance.cash}, {var: now.balance.loan}]}}
      bases:
        - {id: yesterday_sunday, label: По вчерашнему воскресенью, profit: $at.d14.pl.day}
        - {id: average_week, label: По средней неделе, profit: {average: periods}}
        - {id: today_tuesday, label: По сегодняшнему вторнику, profit: $at.d16.pl.day}
        - {id: monday, label: По понедельнику, profit: {period: mon}}
results:
  panels: [answers, {table: horizon}]
tables:
  horizon:
    rows: $metrics.projection.bases
    columns:
      - {label: По какому дню считаем, value: label, format: text}
      - {label: Прибыль дня, value: profit, format: money}
      - {label: Дней до цели, value: horizon, format: int}
trainer: {checkpoint: "1:26"}
```

### move

Своих денег у Малыша — {{at.d16.cash}} минус долг {{at.d16.balance.loan}}.
Смартфон — {{p.goal}}. Через сколько дней накопит?

### results

Осталось накопить {{metrics.projection.remaining}} монет.

### debrief

Один и тот же бизнес даёт прогноз от полутора недель до двух с лишним
месяцев. Врёт не бизнес, врёт выбор базы.

Вчерашнее воскресенье — лучший день недели, понедельник — худший. Честная
база — средняя неделя: в ней есть и выходные, и будни.

### trainer

Цена смартфона называется только здесь.

## step d17 · Итоги игры

Две недели позади. Малыш начинал с одного кувшина во дворе, а закончил
точкой в парке и долгом папе. Посмотрим на игру целиком.

```sim
duration: {min: 11, max: 13}
type: summary
results:
  panels:
    - {statement: {kind: pnl, scope: game}}
    - {statement: {kind: cashflow, scope: game}}
    - {statement: {kind: balance, scope: game}}
    - teams:
        columns:
          - {label: Кувшин, value: $inputs.d2.jug}
          - {label: Цена колы, value: $inputs.d9.cola_price}
          - {label: "Флаеры, кола", value: $inputs.d10.flyers}
          - {label: Цена лимонада, value: $inputs.d11.lemon_price}
          - {label: "Флаеры, лимонад", value: $inputs.d13.flyers}
          - {label: Заготовка, value: $inputs.d14_order.prep}
          - {label: Прибыль, value: $at.d17.pl.cumulative, format: money}
          - {label: Деньги, value: $at.d17.cash, format: money}
          - label: Своих денег
            value: {expr: {"-": [{var: at.d17.cash}, {var: at.d17.balance.loan}]}}
            format: money
          - {label: Дней до смартфона, value: $at.d16_goal.metrics.projection.horizon.average_week, format: int}
    - {takeaways: all}
trainer: {checkpoint: "1:30"}
```

### discussion

- Какое решение стоило вашей команде больше всего денег? Когда вы это
  увидели — в день решения или позже?
- Где в игре прибыль и деньги расходились? Почему?
- По какому дню вы бы считали прогноз для своего бизнеса?

### trainer

Ретро 2 + выводы + финал: 11–13 минут. Два ответа на вопрос, потом
закрываете сами.
