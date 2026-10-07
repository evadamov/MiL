# phase yard · Сезон 1 · Двор

Неделя во дворе: стакан лимонада, мамины кувшины, первые покупатели и
первые долги.

### trainer

Сезон 1 — 14–18 минут, к 0:28 он должен быть закончен. Д3 нельзя резать:
это единственная связка «решение на Д2 → последствие на Д3».

## step intro · Введение

Малышу восемь, и он очень хочет смартфон. Мама говорит: «Заработай сам».
Во дворе жарко, и Малыш решает продавать лимонад.

Ваша команда ведёт его бизнес две недели. Каждый день вы видите, сколько
людей прошло мимо, сколько купили и что стало с деньгами. Иногда решаете
вы.

```sim
duration: {min: 10, max: 10}
trainer: {checkpoint: "0:10"}
```

### trainer

Разбивка по командам: 4–5 человек, 5–9 команд. К 0:10 команды сидят и
вошли в сессию.

## step d1 · Понедельник · Первая партия

Утром мама готовит кувшин — {{p.yard.jug_cups}} стаканов. Ингредиенты на
стакан стоят {{p.yard.cup_cost}} монеты, стакан продаётся за
{{p.yard.price}}. Что не продастся, вечером выльют.

```sim
duration: {min: 3, max: 4}
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: $p.yard.conversion, price: $p.yard.price}
  - use: batch_production
    params: {quantity: $p.yard.jug_cups, unit_cost: $p.yard.cup_cost, source: ingredients}
```

### results

Мимо прошло {{metrics.traffic}} человек, купили {{metrics.sold}}. Один стакан
остался — его вылили, но за ингредиенты уже заплачено.

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
Прибыль дня рекордная. Посмотрите на деньги.

### results

Продано {{metrics.sold}} стаканов, из них {{metrics.sold_credit}} — в долг.

### trainer

Очередь общая: сначала постоянные покупатели (часть просит в долг), потом
те, кого привела сама отсрочка. С одним кувшином до вторых очередь не
доходит. Разбор — завтра, когда вернутся долги.

## step d3 · Среда · Возврат долгов

Сегодня должники обещали вернуть деньги. Мама снова готовит один кувшин.

```sim
duration: {min: 3, max: 4}
inputs:
  - id: collected_forecast
    type: forecast
    label: Сколько монет из вчерашних долгов вернут сегодня?
    unit: монет
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: $p.yard.conversion, price: $p.yard.price}
  - use: batch_production
    params: {quantity: $p.yard.jug_cups, unit_cost: $p.yard.cup_cost, source: ingredients}
results:
  panels:
    - answers
    - facts
    - metrics:
        - {label: Вернули долгов, value: $metrics.collections.returned_amount, format: money}
        - {label: Не вернули, value: $metrics.collections.written_off_amount, format: money}
    - variants
variants:
  - id: jug
    input: d2.jug
    values: options
    columns:
      - {label: Прибыль к Д3, value: $at.d3.pl.cumulative, format: money}
      - {label: Деньги на Д3, value: $at.d3.cash, format: money}
trainer: {protected: true}
```

### debrief

Те, кто пришёл бы и без отсрочки, вернули две трети долга. Те, кого привела
сама отсрочка, — меньше трети. Отсрочка увеличила продажи, но привела не тех
покупателей.

Выручка признаётся в момент продажи, а деньги приходят, только когда
должник платит. Второй кувшин окупается по деньгам, только если
возвращают хотя бы половину долга.

### discussion

Кто купил кувшин — у кого прибыль выше? А деньги? Как так?

## step d4 · Четверг · Только за деньги

У мамы выходной. Она не готовит кувшин заранее, а наливает по ходу дня:
сколько попросили, столько и сделала. Выливать нечего.

В долг Малыш больше не продаёт.

```sim
duration: {min: 2, max: 2}
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
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic, conversion: 0.9, price: $p.yard.promo_price}
  - use: on_demand_production
    params: {unit_cost: $p.yard.cup_cost, source: ingredients}
trainer: {checkpoint: "0:28"}
```

### results

Купили {{metrics.sold}} человек — больше, чем вчера. Людей во дворе
столько же.

### debrief

Скидку получили все, кто и так платил полную цену: 14 человек, по монете с
каждого. Новых покупателей четверо, каждый принёс по 2 монеты сверх
ингредиентов. Минус 14, плюс 8.

Чтобы акция окупилась, нужен был 21 покупатель — на половину больше
обычного. Пришло 18. Трафик не вырос: скидка не привела новых людей, она
только подняла конверсию.

## step d6 · Суббота · Итоги двора

Неделя во дворе закончилась. Посмотрим на неё целиком: прибыль, движение
денег и что у Малыша есть на конец недели.

А дальше — парк: людей там в разы больше.

```sim
duration: {min: 11, max: 13}
type: summary
results:
  panels:
    - statements
    - teams:
        columns:
          - {label: Кувшин, value: $inputs.d2.jug}
          - {label: Прибыль сезона, value: $at.d5.pl.phase, format: money}
          - {label: Деньги, value: $at.d5.cash, format: money}
    - takeaways
trainer: {checkpoint: "0:40"}
```

### discussion

- Прибыль за неделю больше, чем денег на руках. Куда делась разница?
- Что бы вы сделали на Д2 по-другому, зная, кто вернёт долг?
- Акция в пятницу: удалась или нет? По какому числу вы это поняли?

### trainer

Ретро 1 + выводы + переход: 11–13 минут. Два ответа на вопрос, потом
закрываете сами.
