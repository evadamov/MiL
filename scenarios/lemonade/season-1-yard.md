# phase yard · Сезон 1 · Двор

Неделя во дворе: стакан лимонада, мамины кувшины, первые покупатели и
первые долги.

### trainer

Сезон 1 — 15–18 минут, к 0:28 он должен быть закончен. Д3 нельзя резать:
здесь видны последствия отсрочки и решения о заготовке.

## step intro · Введение

Малышу восемь, и он очень хочет смартфон. Мама говорит: «Заработай сам».
Во дворе жарко, и Малыш решает продавать лимонад.

Ваша команда ведёт его бизнес две недели. Каждый день вы видите, сколько
людей прошло мимо, сколько купили и что стало с деньгами. Иногда решаете
вы.

```sim
duration: {min: 10, max: 10}
legend: {image: assets/intro.png, layout: below}
trainer: {checkpoint: "0:10"}
```

### trainer

Разбивка по командам: 4–5 человек, 5–9 команд. К 0:10 команды сидят и
вошли в сессию.

## step d1 · Понедельник · Первая партия

Утром мама готовит кувшин — {{p.yard.jug_cups}} стаканов. Ингредиенты на
стакан стоят {{p.yard.cup_cost}} монеты, стакан продаётся за
{{p.yard.price}}. Что не продастся, пропадёт.

```sim
duration: {min: 3, max: 4}
legend: {image: assets/d1.png, layout: below}
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: $p.yard.conversion, price: $p.yard.price}
  - use: batch_production
    params: {quantity: $p.yard.jug_cups, own_use: $p.yard.own_cups_mon, unit_cost: $p.yard.cup_cost, source: ingredients}
```

### results

Мимо прошло {{metrics.traffic}} человек, купили {{metrics.sold}} — весь кувшин:
{{p.yard.own_cups_mon}} стакан Малыш выпил сам. За ингредиенты заплачено за все
{{p.yard.jug_cups}}.

Когда лимонад закончился, несколько детей сказали: «Мы тоже хотим! Завтра
приноси побольше!»

### trainer

Сегодня команды учатся читать воронку и деньги. Хода нет.

## step d2 · Вторник · Второй кувшин

Малыш разрешает платить завтра — и во двор приходят даже те, у кого с собой
денег нет. Одного кувшина на всех не хватит.

У соседки есть второй кувшин за {{p.yard.second_jug_price}} монет. С ним
мама с утра наполнит оба — по {{p.yard.jug_cups}} стаканов. Утром, до того
как станет ясно, сколько придёт людей.

```sim
duration: {min: 3, max: 4}
legend: {image: assets/d2.png, layout: below}
inputs:
  - id: jug
    type: choice
    label: Покупаем второй кувшин?
    options:
      - {value: buy, label: "Да, за 15 монет"}
      - {value: skip, label: "Нет, хватит одного"}
    default: skip
conditions:
  jug_bought: {expr: {"==": [{var: input.jug}, buy]}}
mechanics:
  - use: capex
    when: jug_bought
    params: {amount: $p.yard.second_jug_price, source: jug}
  - use: credit_sales
    params:
      traffic: 35
      price: $p.yard.price
      segments:
        - {id: regulars_cash, size: 9, pay: cash}
        - {id: regulars_credit, size: 6, pay: credit, return_rate: 0.67, collect_at: d3}
        - {id: late_cash, size: 5, pay: cash}
        - {id: attracted_by_credit, size: 10, pay: credit, return_rate: 0.30, collect_at: d3}
  - use: batch_production
    params:
      quantity: {expr: {if: [{"==": [{var: input.jug}, buy]}, {"*": [{var: p.yard.jug_cups}, 2]}, {var: p.yard.jug_cups}]}}
      unit_cost: $p.yard.cup_cost
      source: ingredients
```

### move

Второй кувшин за {{p.yard.second_jug_price}} монет: 30 стаканов вместо 15.
Покупаем?

### results (if jug_bought)

Продано {{metrics.sold}} стаканов, из них {{metrics.sold_credit}} — в долг.
Прибыль дня рекордная.

### results

Часть стаканов ушла в долг: в «Продано» это число в скобках, деньги за них —
в дебиторке.

### trainer

Очередь общая: сначала постоянные покупатели (часть просит в долг), потом
те, кого привела сама отсрочка. С одним кувшином до вторых очередь не
доходит. Разбор — завтра, когда вернутся долги.

## step d3 · Среда · Возврат долгов

Вечером вторника мама спрашивает, сколько лимонада приготовить на среду.
Если у вас два кувшина, можно наполнить оба или только один. Сколько
покупателей придёт завтра, пока неизвестно. В долг Малыш больше не продаёт.
Должники обещали вернуть деньги в среду.

```sim
duration: {min: 4, max: 4}
legend: {image: assets/d3.png, layout: below}
inputs:
  - id: prep
    type: choice
    label: Сколько кувшинов мама наполнит на среду?
    when: {expr: {"==": [{var: inputs.d2.jug}, buy]}}
    options:
      - {value: one_jug, label: "Один — 15 стаканов"}
      - {value: two_jugs, label: "Оба — 30 стаканов"}
    default: one_jug
  - id: collected_forecast
    type: forecast
    label: Сколько монет из вчерашних долгов вернут сегодня?
    unit: монет
    actual: $metrics.collections.returned_amount
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: $p.yard.conversion, price: $p.yard.price}
  - use: batch_production
    params:
      quantity: {expr: {if: [{"==": [{var: input.prep}, two_jugs]}, {"*": [{var: p.yard.jug_cups}, 2]}, {var: p.yard.jug_cups}]}}
      unit_cost: $p.yard.cup_cost
      source: ingredients
results:
  panels:
    - choices
    - answers
    - facts
    - title: Возврат долгов
      metrics:
        - {label: Вернули долгов, value: $metrics.collections.returned_amount, format: money}
        - {label: Не вернули, value: $metrics.collections.written_off_amount, format: money}
trainer: {protected: true}
```

### move

Если купили второй кувшин, решите, наполнять ли его. Все команды
оценивают, сколько вчерашних долгов вернут сегодня.

## step d4 · Четверг · Только за деньги

У мамы выходной. Она не готовит кувшин заранее, а наливает по ходу дня:
сколько попросили, столько и сделала. Лишнего не остаётся.

```sim
duration: {min: 2, max: 2}
legend: {image: assets/d4.png, layout: below}
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: $p.yard.conversion, price: $p.yard.price}
  - use: on_demand_production
    params: {unit_cost: $p.yard.cup_cost, source: ingredients}
```

## step d5 · Пятница · Акция

Мама опять наливает по ходу дня. Малыш решает устроить акцию: стакан за
{{p.yard.promo_price}} вместо {{p.yard.price}}.

```sim
duration: {min: 3, max: 4}
legend: {image: assets/d5.png, layout: below}
inputs:
  - id: sold_forecast
    type: forecast
    label: Сколько стаканов продадим сегодня по 4 монеты?
    unit: стаканов
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: 0.9, price: $p.yard.promo_price}
  - use: on_demand_production
    params: {unit_cost: $p.yard.cup_cost, source: ingredients}
trainer: {checkpoint: "0:28"}
```

### move

Сколько стаканов получится продать по {{p.yard.promo_price}} монеты?

### results

Купили {{metrics.sold}} человек — больше, чем вчера. Людей во дворе
столько же.

## step d6 · Суббота · Итоги двора

Неделя во дворе закончилась. Посмотрим на неё целиком: прибыль, движение
денег и что у Малыша есть на конец недели.

```sim
duration: {min: 8, max: 9}
type: summary
legend: {image: assets/d6.png, layout: below}
results:
  panels:
    - statements
    - teams:
        columns:
          - {label: Кувшин, value: $inputs.d2.jug}
          - {label: Прибыль сезона, value: $at.d5.pl.phase, format: money}
          - {label: Деньги, value: $at.d5.cash, format: money}
trainer: {checkpoint: "0:40"}
```

### discussion

Сначала сравните результат от продаж, не включая списание вторничных
долгов. В отчёте среды этот долг показан отдельной строкой.

| День и заготовка | Продано | Выручка | Ингредиенты | Результат от продаж |
|---|---:|---:|---:|---:|
| Среда · 15 стаканов | 14 | 70 | 30 | 40 |
| Среда · 30 стаканов | 14 | 70 | 60 | 10 |
| Четверг · по спросу | 14 | 70 | 28 | 42 |
| Пятница · цена 4 | 18 | 72 | 36 | 36 |

- Когда лимонад закончился в первый день, что мы узнали о спросе, а что
  предположили со слов детей?
- После продажи с отсрочкой прибыль и деньги разошлись. Почему?
- Если бы вы продолжили торговать во дворе, во что вложили бы деньги?
  Каких данных не хватает, чтобы обосновать это решение?
- Акция увеличила продажи с 14 до 18 стаканов. Повторили бы вы её? Сколько
  нужно продать по новой цене, чтобы сохранить прежнюю прибыль?
- Во вторник с двумя кувшинами продали 30 стаканов. Можно ли готовить по 30
  каждый день? Какие условия того дня сохранились?

### trainer

Ретро 1: сначала покажите таблицу финансовых результатов, затем собирайте
версии команд. Не называйте размер двора как установленный факт: стагнация
продаж даёт повод проверить доступный сегмент, но не доказывает его размер.
Выводы и переход — на следующем шаге.

## step d6_lessons · Суббота · Выводы двора

Посмотрим на причины расхождения между продажами, прибылью и деньгами.

Во вторник, если купили второй кувшин, 6 покупателей взяли в долг и пришли
бы без отсрочки: в среду заплатили 4. Ещё 10 покупателей привлекла сама
отсрочка: заплатили 3. Продажа в долг увеличила выручку, но часть денег
так и не пришла.

В пятницу скидку получили 14 покупателей, которые и так платили полную
цену: это минус 14 монет. Четверо дополнительных покупателей принесли по
2 монеты после оплаты ингредиентов: это плюс 8. Чтобы сохранить прежнюю
прибыль, нужно было продать 21 стакан. Продали 18.

```sim
duration: {min: 3, max: 4}
type: summary
results:
  panels:
    - takeaways
```

### trainer

После обсуждения покажите расчёт и затем пять выводов. Цифры по сегментам
относятся к варианту с двумя кувшинами. Если кувшин не купили, до группы,
которую привела отсрочка, очередь не дошла.
