---
id: rink_tea
version: 1
title: Чай на катке
locale: ru
duration_min: 30
format: 1
library: 1
teams: {min: 2, max: 8, recommended: [3, 6]}
---

Выходные на городском катке: Соня продаёт горячий чай из термосов.
Три дня, каждое утро — сколько заварить, в субботу — платная растяжка у
входа. Урок: объём готовят под спрос конкретного дня, а реклама без запаса
продукта — выброшенные деньги.

Короткий пример. Он проверяет, что платформа не завязана на структуру
«Малыша и лимонада»: одна фаза вместо двух сезонов, одно и то же решение
каждый шаг, два ввода в одном шаге, другие числа и валюта. Механики — те
же, что в лимонаде. Канона нет: числа выбраны так, чтобы уроки держались
на любом наборе решений.

```sim
currency: {label: ₽, short: ₽}

params:
  price: 40
  cup_cost: 10
  thermos_cups: 20
  stand: 500
  conversion: 0.25
  traffic: {fri: 150, sat: 300, sun: 250}
  banner:
    - {key: none, cost: 0, traffic_add: 0}
    - {key: banner, cost: 600, traffic_add: 100}

accounts:
  fixed_costs: {label: Аренда места}
  marketing: {label: Растяжка}
  waste: {label: Остывший чай}

sources:
  sales: Продажи
  production: Заварка и стаканы
  stand: Аренда места
  marketing: Растяжка

reference: reference_team
```

# phase weekend · Выходные на катке

## step fri · Пятница

Соня арендует место у катка — {{p.stand}} ₽ в день. Чай по {{p.price}} ₽,
заварка и стакан — {{p.cup_cost}} ₽. Утром она заваривает термосы по
{{p.thermos_cups}} стаканов. Остывший к вечеру чай выливают.

Пятница: катаются в основном после работы.

```sim
duration: {min: 6, max: 7}
inputs:
  - id: thermoses
    type: number
    label: Сколько термосов заварить?
    unit: термосов
    min: 0
    max: 8
    step: 1
    samples: [1, 2, 3]
    default: 2
mechanics:
  - use: funnel
    params: {traffic: $p.traffic.fri, conversion: $p.conversion, price: $p.price}
  - use: batch_production
    params:
      quantity: {expr: {"*": [{var: input.thermoses}, {var: p.thermos_cups}]}}
      unit_cost: $p.cup_cost
  - use: fixed_costs
    params: {amount: $p.stand, source: stand}
variants:
  - id: thermoses
    input: fri.thermoses
    values: [1, 2, 3]
    columns:
      - {label: Продано, value: $at.fri.metrics.sold, format: int}
      - {label: Вылили, value: $at.fri.metrics.waste_units, format: int}
      - {label: Прибыль дня, value: $at.fri.pl.day, format: money}
```

### move

Сколько термосов по {{p.thermos_cups}} стаканов заварить на пятницу?

## step sat · Суббота

Выходной, на катке вдвое больше людей. Администрация предлагает повесить
растяжку у входа: {{p.banner.1.cost}} ₽, обещают ещё
{{p.banner.1.traffic_add}} человек мимо палатки.

```sim
duration: {min: 7, max: 8}
inputs:
  - id: banner
    type: choice
    label: Вешаем растяжку?
    options:
      - {value: banner, label: "Да, за 600 ₽"}
      - {value: none, label: "Нет"}
    default: none
  - id: thermoses
    type: number
    label: Сколько термосов заварить?
    unit: термосов
    min: 0
    max: 8
    step: 1
    samples: [3, 4, 5]
    default: 4
mechanics:
  - use: funnel
    params: {traffic: $p.traffic.sat, conversion: $p.conversion, price: $p.price}
  - use: channel
    params: {choice: $input.banner, tiers: $p.banner}
  - use: batch_production
    params:
      quantity: {expr: {"*": [{var: input.thermoses}, {var: p.thermos_cups}]}}
      unit_cost: $p.cup_cost
  - use: fixed_costs
    params: {amount: $p.stand, source: stand}
variants:
  - id: banner
    input: sat.banner
    values: options
    columns:
      - {label: Хотели купить, value: $at.sat.metrics.demand, format: int}
      - {label: Продано, value: $at.sat.metrics.sold, format: int}
      - {label: Прибыль дня, value: $at.sat.pl.day, format: money}
```

### move

Растяжка за {{p.banner.1.cost}} ₽ и сколько термосов заварить на субботу?

### debrief

Термос — это обязательство по объёму до того, как виден спрос. Не хватило —
покупатель ушёл, лишний — вылили, а заварка оплачена.

Растяжка приводит людей, но продать им можно только то, что заварено.
Реклама без запаса — это плата за покупателей, которые уйдут без чая.

## step sun · Воскресенье

Людей меньше, чем в субботу, но больше, чем в пятницу.

```sim
duration: {min: 5, max: 6}
inputs:
  - id: thermoses
    type: number
    label: Сколько термосов заварить?
    unit: термосов
    min: 0
    max: 8
    step: 1
    samples: [3, 4, 5]
    default: 4
mechanics:
  - use: funnel
    params: {traffic: $p.traffic.sun, conversion: $p.conversion, price: $p.price}
  - use: batch_production
    params:
      quantity: {expr: {"*": [{var: input.thermoses}, {var: p.thermos_cups}]}}
      unit_cost: $p.cup_cost
  - use: fixed_costs
    params: {amount: $p.stand, source: stand}
variants:
  - id: thermoses
    input: sun.thermoses
    values: [3, 4, 5]
    columns:
      - {label: Продано, value: $at.sun.metrics.sold, format: int}
      - {label: Вылили, value: $at.sun.metrics.waste_units, format: int}
      - {label: Прибыль дня, value: $at.sun.pl.day, format: money}
```

### move

Сколько термосов заварить на воскресенье?

### debrief

Кто заварил по субботе, вылил полтермоса. Иногда выгоднее недодать
несколько стаканов, чем заварить целый термос впрок: недополученная
выручка с трёх стаканов меньше, чем заварка двадцати.

## step summary · Итоги выходных

Три дня позади. Сколько заработали и сколько вылили?

```sim
duration: {min: 5, max: 6}
type: summary
results:
  panels:
    - {statement: {kind: pnl, scope: game}}
    - teams:
        columns:
          - {label: Пт, value: $inputs.fri.thermoses}
          - {label: Растяжка, value: $inputs.sat.banner}
          - {label: Сб, value: $inputs.sat.thermoses}
          - {label: Вс, value: $inputs.sun.thermoses}
          - {label: Прибыль, value: $at.summary.pl.cumulative, format: money}
          - {label: Деньги, value: $at.summary.cash, format: money}
    - takeaways
```

### discussion

В какой день вы вылили больше всего? Что бы вы спросили у администрации
катка, прежде чем платить за растяжку?

# lessons

## lesson prep_by_day · Готовить по вчерашнему дню

Объём считают по типу дня, а не по вчерашней выручке.

```sim
phase: weekend
takeaway: true
kind: contrast
contrast: {input: sun.thermoses, a: 5, b: 3}
assert: {"<": [{var: a.at.sun.pl.day}, {var: b.at.sun.pl.day}]}
```

## lesson marketing_needs_supply · Реклама без запаса

Сначала проверить, есть ли что продать новым покупателям, потом звать их.

```sim
phase: weekend
takeaway: true
kind: contrast
contrast:
  input: sat.banner
  a: banner
  b: none
  where: {expr: {"<=": [{"*": [{var: a.at.sat.input.thermoses}, {var: p.thermos_cups}]}, {var: b.at.sat.metrics.demand}]}}
assert: {"<": [{var: a.at.sat.pl.day}, {var: b.at.sat.pl.day}]}
```

# checks

## check reference_team · Эталонная команда

Два термоса в пятницу, растяжка и пять термосов в субботу, три в
воскресенье.

```sim
decisions:
  fri.thermoses: 2
  sat.banner: banner
  sat.thermoses: 5
  sun.thermoses: 3
expect:
  at.fri.metrics.demand: 38
  at.fri.metrics.sold: 38
  at.fri.metrics.waste_units: 2
  at.fri.pl.day: 620
  at.fri.cash: 620
  at.sat.metrics.traffic: 400
  at.sat.metrics.demand: 100
  at.sat.pl.day: 1900
  at.sat.cash: 2520
  at.sun.metrics.demand: 63
  at.sun.metrics.sold: 60
  at.sun.pl.day: 1300
  at.sun.pl.phase: 3820
  at.sun.cash: 3820
  at.sun.check.balance: 0
```

## check sweep_fri · Пятница: термосы

```sim
sweep:
  base: reference_team
  input: fri.thermoses
  rows:
    - {value: 1, expect: {at.fri.metrics.sold: 20, at.fri.pl.day: 100}}
    - {value: 2, expect: {at.fri.metrics.sold: 38, at.fri.pl.day: 620}}
    - {value: 3, expect: {at.fri.metrics.sold: 38, at.fri.metrics.waste_units: 22, at.fri.pl.day: 420}}
```

## check sat_no_banner · Суббота без растяжки

```sim
decisions:
  sat.banner: none
  sat.thermoses: 4
expect:
  at.sat.metrics.demand: 75
  at.sat.pl.day: 1700
```

## check sweep_sat_banner · Суббота: растяжка при четырёх термосах

```sim
sweep:
  base: sat_no_banner
  input: sat.banner
  rows:
    - {value: none, expect: {at.sat.metrics.sold: 75, at.sat.pl.day: 1700}}
    - {value: banner, expect: {at.sat.metrics.sold: 80, at.sat.pl.day: 1300}}
```

## check sweep_sun · Воскресенье: термосы

```sim
sweep:
  base: reference_team
  input: sun.thermoses
  rows:
    - {value: 3, expect: {at.sun.metrics.sold: 60, at.sun.pl.day: 1300}}
    - {value: 4, expect: {at.sun.metrics.sold: 63, at.sun.pl.day: 1220}}
    - {value: 5, expect: {at.sun.metrics.sold: 63, at.sun.metrics.waste_units: 37, at.sun.pl.day: 1020}}
```
