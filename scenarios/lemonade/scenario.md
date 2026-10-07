---
id: lemonade
version: 17
title: Малыш и лимонад
locale: ru
duration_min: 90
format: 1
library: 1
teams: {min: 3, max: 10, recommended: [5, 9]}
include: [season-1-yard.md, season-2-park.md]
---

Малыш продаёт лимонад — сначала во дворе, потом в парке на папин заём.
Два сезона, двадцать шагов, шесть решений, которые влияют на деньги.
Выручка и деньги, скидки, юнит-экономика и безубыточность, цена, каналы
привлечения, прогноз.

Канон чисел — [canon/context-v16.md](canon/context-v16.md). Сценарий обязан
его воспроизводить: см. раздел `# checks`.

```sim
currency: {label: монет, short: м}

params:
  goal: 3000                    # цена смартфона; называется только на Д16
  yard:
    price: 5
    promo_price: 4
    cup_cost: 2
    jug_cups: 15
    second_jug_price: 15
    traffic: 20
    conversion: 0.7
  park:
    loan: 500
    equipment: 330
    cola_units: 20
    cola_cost: 4
    cola_price_d8: 6
    cola_price: 7
    cola_conversion: 0.12
    cola_price_table:
      - {price: 5, conversion: 0.157}
      - {price: 6, conversion: 0.130}
      - {price: 7, conversion: 0.120}
      - {price: 8, conversion: 0.074}
    lemon_cost: 2
    lemon_price: 9
    lemon_conversion: 0.16
    monday_conversion: 0.155
    lemon_price_table:
      - {price: 7, conversion: 0.176}
      - {price: 9, conversion: 0.160}
      - {price: 11, conversion: 0.109}
    place: 60
    ice: 10
    working_flyers: 300
    traffic: {mon: 100, tue: 108, wed: 108, thu: 108, fri: 119, sat: 200, sun: 290}
  flyers:
    - {key: 0, cost: 0, traffic_add: 0}
    - {key: 100, cost: 10, traffic_add: 8}
    - {key: 300, cost: 24, traffic_add: 23}
    - {key: 500, cost: 30, traffic_add: 34}

accounts:
  receivables: {label: Долги покупателей}
  equipment: {label: Оборудование}
  inventory: {label: Запас колы}
  loan: {label: Долг папе}
  waste: {label: Списания}
  bad_debt: {label: Невозвращённые долги}
  fixed_costs: {label: Место и лёд}
  marketing: {label: Флаеры}

sources:
  sales: Продажи
  collections: Возврат долгов
  ingredients: Ингредиенты
  jug: Второй кувшин
  dad_loan: Заём папы
  park_equipment: Оборудование для парка
  cola_stock: Стартовый запас колы
  cola_restock: Докупка колы
  cola_selloff: Распродажа колы
  place: Место в парке
  ice: Лёд
  marketing: Флаеры

reference: reference_team
```

# info

## page yard · Параметры двора

| Параметр | Значение |
|---|---:|
| Цена стакана | {{p.yard.price}} |
| Ингредиенты на стакан | {{p.yard.cup_cost}} |
| Кувшин | {{p.yard.jug_cups}} стаканов |

Пн–Ср мама готовит кувшины утром: объём фиксирован до того, как виден
спрос, непроданное выливают. Чт–Пт наливает по ходу дня, выливать нечего.

```sim
from: d1
```

## page park · Параметры парка

| Параметр | Значение |
|---|---:|
| Заём папы | {{p.park.loan}} |
| Оборудование | {{p.park.equipment}} |
| Место в парке, в день | {{p.park.place}} |
| Лёд, в день | {{p.park.ice}} |
| Закупка бутылки колы | {{p.park.cola_cost}} |
| Ингредиенты лимонада, за стакан | {{p.park.lemon_cost}} |

| Флаеры | Стоимость |
|---:|---:|
| 100 | {{p.flyers.1.cost}} |
| 300 | {{p.flyers.2.cost}} |
| 500 | {{p.flyers.3.cost}} |

```sim
from: d7
```

# lessons

## lesson revenue_is_not_cash · Считать продажу деньгами

Отделять выручку от денег: у отсрочки есть срок, возвратность и сегмент.
Бесплатное и «потом» привлекают не тех, кто платит.

```sim
phase: yard
takeaway: true
kind: contrast
contrast: {input: d2.jug, a: buy, b: skip}
assert:
  and:
    - {">": [{var: a.at.d3.pl.cumulative}, {var: b.at.d3.pl.cumulative}]}
    - {"<": [{var: a.at.d3.cash}, {var: b.at.d3.cash}]}
```

## lesson interest_is_not_demand · Принимать интерес за спрос

Спрашивать про деньги, а не про желание.

```sim
phase: yard
takeaway: true
kind: unverified
```

## lesson discount_without_math · Делать скидки для роста, не считая экономику

Дополнительный спрос должен компенсировать потерю маржи.

```sim
phase: yard
takeaway: true
kind: path
assert:
  and:
    - {"==": [{var: at.d5.metrics.traffic}, {var: at.d4.metrics.traffic}]}
    - {">": [{var: at.d5.metrics.sold}, {var: at.d4.metrics.sold}]}
    - {"<": [{var: at.d5.pl.day}, {var: at.d4.pl.day}]}
```

## lesson segment_size · Не учитывать размер сегмента

Проверять потолок рынка до масштабирования.

```sim
phase: yard
takeaway: true
kind: unverified
```

## lesson scaling_first_sales · Масштабировать по первым продажам

Отделять всплеск от устойчивого спроса.

```sim
phase: yard
takeaway: true
kind: unverified
```

## lesson unit_economics_is_not_business · Положительная экономика одной продажи ≠ бизнес

Считать безубыточность с постоянными расходами.

```sim
phase: park
takeaway: true
kind: path
assert:
  and:
    - {">": [{var: at.d8.metrics.unit_margin}, 0]}
    - {"<": [{var: at.d8.pl.day}, 0]}
```

## lesson demand_drivers · Не понимать драйверы спроса

Считать по типам дня, а не по вчера.

```sim
phase: park
takeaway: true
kind: path
assert:
  and:
    - {"<=": [{"-": [{var: at.d15.metrics.demand_conversion}, {var: at.d14.metrics.demand_conversion}]}, 0.01]}
    - {">=": [{"-": [{var: at.d15.metrics.demand_conversion}, {var: at.d14.metrics.demand_conversion}]}, -0.01]}
    - {"<": [{"*": [{var: at.d15.metrics.traffic}, 2]}, {var: at.d14.metrics.traffic}]}
```

## lesson price_two_maxima · Бояться повышать цену

Максимум покупателей и максимум денег — разные точки.

```sim
phase: park
takeaway: true
kind: sweep
sweep: {input: d11.lemon_price}
assert:
  "!=":
    - {argmax: [{var: rows}, at.d12.metrics.sold]}
    - {argmax: [{var: rows}, at.d12.pl.day]}
```

## lesson price_two_maxima_cola · Цена колы: тот же разрыв

Тот же вывод на коле: по 5 продаётся больше всего, по 7 — меньше всего
убыток.

```sim
phase: park
takeaway: false
kind: sweep
sweep: {input: d9.cola_price}
assert:
  "!=":
    - {argmax: [{var: rows}, at.d9.metrics.sold]}
    - {argmax: [{var: rows}, at.d9.pl.day]}
```

## lesson paid_discovery · Искать рабочую модель после запуска

Discovery после запуска платный.

```sim
phase: park
takeaway: true
kind: path
assert: {"<": [{var: at.d11.pl.day}, 0]}
```

## lesson copy_competitors · Копировать конкурентов

Проверять, чем предложение отличается.

```sim
phase: park
takeaway: true
kind: unverified
```

## lesson one_metric · Смотреть только на одну метрику

Продажи выросли — прибыль упала. Канал оценивают по деньгам, а не по
продажам.

```sim
phase: park
takeaway: false
kind: contrast
contrast: {input: d10.flyers, a: 300, b: 0}
assert:
  and:
    - {">": [{var: a.at.d10.metrics.sold}, {var: b.at.d10.metrics.sold}]}
    - {"<": [{var: a.at.d10.pl.day}, {var: b.at.d10.pl.day}]}
```

## lesson channel_without_offer · Канал без предложения

Если предложение не совпадает с аудиторией, любой тираж хуже нуля.

```sim
phase: park
takeaway: false
kind: contrast
contrast: {input: d10.flyers, a: [100, 300, 500], b: 0, quantifier: all}
assert: {"<": [{var: a.at.d10.pl.day}, {var: b.at.d10.pl.day}]}
```

## lesson channel_matches_offer · Канал с предложением

Когда предложение совпало с теми, кого звали, флаер поднимает и трафик, и
конверсию — хотя бы один тираж лучше нуля.

```sim
phase: park
takeaway: false
kind: contrast
contrast: {input: d13.flyers, a: [100, 300, 500], b: 0, quantifier: any}
assert:
  and:
    - {">": [{var: a.at.d13.pl.day}, {var: b.at.d13.pl.day}]}
    - {">": [{var: a.at.d13.metrics.conversion}, {var: b.at.d13.metrics.conversion}]}
```

## lesson forecast_base · Прогноз по удобной базе

Врёт не бизнес, врёт выбор базы. Прогноз считают по средней неделе, а не
по вчерашнему дню.

```sim
phase: park
takeaway: false
kind: path
assert:
  "<":
    - {var: at.d16_goal.metrics.projection.horizon.yesterday_sunday}
    - {var: at.d16_goal.metrics.projection.horizon.average_week}
    - {var: at.d16_goal.metrics.projection.horizon.monday}
```

# checks

## check reference_team · Референсная команда v16

Кувшин куплен, кола 7, 300 флаеров, лимонад 9, 300 флаеров, заготовка 19.
Канон: разделы 3 и «Итог референсной команды» в `canon/context-v16.md`.

```sim
decisions:
  d2.jug: buy
  d9.cola_price: 7
  d10.flyers: 300
  d11.lemon_price: 9
  d13.flyers: 300
  d14_order.prep: 19
expect:
  at.d1.pl.day: 40
  at.d1.cash: 40
  at.d2.pl.day: 90
  at.d2.cash: 35
  at.d2.metrics.traffic: 35
  at.d2.metrics.sold: 30
  at.d2.metrics.sold_cash: 14
  at.d2.metrics.sold_credit: 16
  at.d3.pl.day: -5
  at.d3.cash: 110
  at.d3.pl.lines.bad_debt: 45
  at.d3.metrics.collections.returned_amount: 35
  at.d4.pl.day: 42
  at.d4.cash: 152
  at.d5.pl.day: 36
  at.d5.cash: 188
  at.d5.pl.phase: 203
  at.d5.balance.equipment: 15
  at.d7.cash: 278
  at.d8.pl.day: -42
  at.d8.metrics.sold: 14
  at.d9.pl.day: -31
  at.d10.pl.day: -46
  at.d11.pl.day: -60
  at.d11.cash: 179
  at.d12.pl.day: 63
  at.d13.pl.day: 186
  at.d14.metrics.traffic: 313
  at.d14.metrics.sold: 50
  at.d14.pl.day: 256
  at.d14.cash: 684
  at.d15.metrics.traffic: 123
  at.d15.pl.day: 39
  at.d16.metrics.traffic: 131
  at.d16.metrics.sold: 21
  at.d16.pl.day: 53
  at.d16.pl.phase: 418
  at.d16.pl.cumulative: 621
  at.d16.cash: 776
  at.d16.balance.loan: 500
  at.d16.balance.equipment: 345
  at.d16.check.balance: 0
  at.d16_goal.metrics.projection.total: 721
  at.d16_goal.metrics.projection.average: 103
  at.d16_goal.metrics.projection.current: 276
  at.d16_goal.metrics.projection.remaining: 2724
  at.d16_goal.metrics.projection.horizon.yesterday_sunday: 11
  at.d16_goal.metrics.projection.horizon.average_week: 26
  at.d16_goal.metrics.projection.horizon.today_tuesday: 51
  at.d16_goal.metrics.projection.horizon.monday: 70
```

## check no_jug · Ветка «без кувшина»

```sim
decisions:
  d2.jug: skip
  d9.cola_price: 7
  d10.flyers: 300
  d11.lemon_price: 9
  d13.flyers: 300
  d14_order.prep: 19
expect:
  at.d2.metrics.sold: 15
  at.d2.metrics.sold_cash: 9
  at.d2.metrics.sold_credit: 6
  at.d3.pl.lines.bad_debt: 10
  at.d3.pl.cumulative: 115
  at.d3.cash: 115
  at.d5.pl.phase: 193
  at.d5.cash: 193
```

## check sweep_d2 · Д2–Д3: кувшин

```sim
sweep:
  base: reference_team
  input: d2.jug
  rows:
    - {value: buy, expect: {at.d3.pl.cumulative: 125, at.d3.cash: 110}}
    - {value: skip, expect: {at.d3.pl.cumulative: 115, at.d3.cash: 115}}
```

## check sweep_d9 · Д9: цена колы

```sim
sweep:
  base: reference_team
  input: d9.cola_price
  rows:
    - {value: 5, expect: {at.d9.metrics.sold: 17, at.d9.pl.day: -53}}
    - {value: 6, expect: {at.d9.metrics.sold: 14, at.d9.pl.day: -42}}
    - {value: 7, expect: {at.d9.metrics.sold: 13, at.d9.pl.day: -31}}
    - {value: 8, expect: {at.d9.metrics.sold: 8, at.d9.pl.day: -38}}
```

## check sweep_d10 · Д10: флаеры на колу

```sim
sweep:
  base: reference_team
  input: d10.flyers
  rows:
    - {value: 0, expect: {at.d10.metrics.traffic: 108, at.d10.metrics.sold: 13, at.d10.pl.day: -31}}
    - {value: 100, expect: {at.d10.metrics.traffic: 116, at.d10.metrics.sold: 14, at.d10.pl.day: -38}}
    - {value: 300, expect: {at.d10.metrics.traffic: 131, at.d10.metrics.sold: 16, at.d10.pl.day: -46}}
    - {value: 500, expect: {at.d10.metrics.traffic: 142, at.d10.metrics.sold: 17, at.d10.pl.day: -49}}
```

## check sweep_d12 · Д12: цена лимонада

```sim
sweep:
  base: reference_team
  input: d11.lemon_price
  rows:
    - {value: 7, expect: {at.d12.metrics.sold: 21, at.d12.pl.day: 35}}
    - {value: 9, expect: {at.d12.metrics.sold: 19, at.d12.pl.day: 63}}
    - {value: 11, expect: {at.d12.metrics.sold: 13, at.d12.pl.day: 47}}
```

## check sweep_d13 · Д13: флаеры на лимонад

```sim
sweep:
  base: reference_team
  input: d13.flyers
  rows:
    - {value: 0, expect: {at.d13.metrics.traffic: 200, at.d13.metrics.sold: 32, at.d13.pl.day: 154}}
    - {value: 100, expect: {at.d13.metrics.traffic: 208, at.d13.metrics.sold: 36, at.d13.pl.day: 172}}
    - {value: 300, expect: {at.d13.metrics.traffic: 223, at.d13.metrics.sold: 40, at.d13.pl.day: 186}}
    - {value: 500, expect: {at.d13.metrics.traffic: 234, at.d13.metrics.sold: 40, at.d13.pl.day: 180}}
```

## check sweep_d15 · Д15: заготовка на понедельник

```sim
sweep:
  base: reference_team
  input: d14_order.prep
  rows:
    - {value: 15, expect: {at.d15.metrics.sold: 15, at.d15.metrics.waste_units: 0, at.d15.pl.day: 11}}
    - {value: 19, expect: {at.d15.metrics.sold: 19, at.d15.metrics.waste_units: 0, at.d15.pl.day: 39}}
    - {value: 25, expect: {at.d15.metrics.sold: 19, at.d15.metrics.waste_units: 6, at.d15.pl.day: 27}}
    - {value: 30, expect: {at.d15.metrics.sold: 19, at.d15.metrics.waste_units: 11, at.d15.pl.day: 17}}
    - {value: 40, expect: {at.d15.metrics.sold: 19, at.d15.metrics.waste_units: 21, at.d15.pl.day: -3}}
    - {value: 50, expect: {at.d15.metrics.sold: 19, at.d15.metrics.waste_units: 31, at.d15.pl.day: -23}}
```
