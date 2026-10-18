# phase yard · Сезон 1 · Двор

Неделя во дворе: Малыш продаёт лимонад, считает первые деньги и впервые
сталкивается с долгами покупателей.

### trainer

Сезон 1 — 15–18 минут, к 0:28 он должен быть закончен. Д3 нельзя резать:
здесь видны последствия отсрочки и решения о заготовке.

## step intro · Введение

Малыш просит у мамы денег на смартфон. Мама предлагает заработать самому и
обещает помочь. Во дворе жарко; знакомые жалуются, что за прохладным
напитком приходится идти домой. Малыш решает продавать лимонад.

Следующие две недели вы помогаете ему вести дело. Каждый день вы увидите,
сколько людей прошло мимо, сколько купили лимонад и что произошло с
деньгами.

Начинаем с простых вещей и будем постепенно разбираться с более сложными.
Вперёд!

```sim
duration: {min: 10, max: 10}
legend: {image: assets/intro.png, layout: below}
trainer: {checkpoint: "0:10"}
```

### trainer

Разбивка по командам: 4–5 человек, 5–9 команд. К 0:10 команды сидят и
вошли в сессию.

## step d1 · Понедельник · Первая партия

Утром мама готовит кувшин лимонада на 15 стаканов. Приготовленный лимонад
стоит Малышу 30 монет — по 2 монеты за стакан. Он продаёт стакан за 5 монет.
Непроданный лимонад к вечеру пропадёт.

```sim
duration: {min: 3, max: 4}
legend: {image: assets/d1.png, layout: below}
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic.mon, conversion: $p.yard.conversion.mon, price: $p.yard.price}
  - use: batch_production
    params: {quantity: $p.yard.jug_cups, own_use: $p.yard.own_cups_mon, unit_cost: $p.yard.cup_cost, source: ingredients}
```

### results

Мимо прошёл {{metrics.traffic}} человек. Один стакан Малыш выпил сам,
{{metrics.sold}} продал — кувшин опустел. Ещё нескольким людям лимонада не
досталось.

Подходили и дети без денег: они хотели купить лимонад и спрашивали, можно
ли заплатить позже.

Кажется, бизнес идёт. И смартфон всё ближе.

### trainer

Сегодня команды учатся читать воронку и деньги. Хода нет.

## step d2 · Вторник · Второй кувшин

Малыш вспоминает детей, которые вчера просили заплатить позже. Он решает
сегодня продавать с отсрочкой: покупателей может стать больше. А вдруг
одного кувшина не хватит?

Соседка продаёт кувшин за {{p.yard.second_jug_price}} монет. Если его
купить, мама утром приготовит сразу два кувшина по
{{p.yard.jug_cups}} стаканов. Решить нужно до начала торговли.

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

Продано {{metrics.sold}} стаканов, из них {{metrics.sold_credit}} — с
оплатой завтра. В строке «Продано» эти {{metrics.sold_credit}} стаканов
указаны в скобках; долг покупателей виден в дебиторке. В отчёте прибыль
выше, чем в понедельник.

### results

Часть стаканов отдали с оплатой завтра. В строке «Продано» они указаны в
скобках; долг покупателей виден в дебиторке.

### trainer

Очередь общая: сначала постоянные покупатели (часть просит в долг), потом
те, кого привела сама отсрочка. С одним кувшином до вторых очередь не
доходит. Разбор — завтра, когда вернутся долги.

## step d3 · Среда · Возврат долгов

Утром мама спрашивает, сколько лимонада приготовить. Если у вас два
кувшина, можно наполнить оба или только один. После вчерашнего дня
Малышу неспокойно продавать в долг: сегодня он берёт деньги сразу.
Вчерашние покупатели обещали вернуть долг к вечеру.

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
    max: $at.d2.balance.receivables
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic.wed, conversion: $p.yard.conversion.wed, price: $p.yard.price}
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

Если купили второй кувшин, решите, наполнять ли его сегодня. Все команды
прогнозируют, сколько вчерашних долгов вернётся к вечеру.

## step d4 · Четверг · Только за деньги

Вчера непроданный лимонад пропал. Сегодня у мамы выходной, и она может
готовить по мере покупок. Лишнего не остаётся.

```sim
duration: {min: 2, max: 2}
legend: {image: assets/d4.png, layout: below}
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic.thu, conversion: $p.yard.conversion.thu, price: $p.yard.price}
  - use: on_demand_production
    params: {unit_cost: $p.yard.cup_cost, source: ingredients}
```

### results

Продали {{metrics.sold}} стаканов. Мама приготовила ровно столько, сколько
купили, — за лишний лимонад платить не пришлось.

## step d5 · Пятница · Акция

«Может, сделаем скидку и продадим больше? Смартфон сам себя не купит», —
говорит Малыш. Сегодня он продаёт стакан за {{p.yard.promo_price}} монеты
вместо {{p.yard.price}} и не даёт в долг. Мама снова готовит лимонад по
мере покупок.

```sim
duration: {min: 3, max: 4}
legend: {image: assets/d5.png, layout: below}
inputs:
  - id: sold_forecast
    type: forecast
    label: Сколько стаканов купят сегодня по 4 монеты?
    unit: стаканов
    actual: $metrics.sold
mechanics:
  - use: funnel
    params: {traffic: $p.yard.traffic.fri, conversion: $p.yard.conversion.fri, price: $p.yard.promo_price}
  - use: on_demand_production
    params: {unit_cost: $p.yard.cup_cost, source: ingredients}
trainer: {checkpoint: "0:28"}
```

### move

Вчера по {{p.yard.price}} монет купили {{at.d4.metrics.sold}} стаканов.
Сколько купят сегодня по {{p.yard.promo_price}}?

### results

Сегодня мимо прошло {{metrics.traffic}} человек, вчера —
{{at.d4.metrics.traffic}}. Купили {{metrics.sold}} стаканов против
{{at.d4.metrics.sold}} вчера.

## step d6 · Суббота · Итоги двора

Малыш устраивает себе выходной и подводит итоги недели. На экране —
результаты команд; подробные отчёты доступны вам на телефонах.

```sim
duration: {min: 11, max: 13}
type: summary
legend: {image: assets/d6.png, layout: below}
results:
  panels:
    - statements
    - teams:
        columns:
          - {label: Кувшин, value: $inputs.d2.jug}
          - {label: Заготовка в среду, value: $inputs.d3.prep}
          - {label: Прибыль сезона, value: $at.d5.pl.phase, format: money}
          - {label: Деньги в кассе, value: $at.d5.cash, format: money}
    - takeaways
trainer: {checkpoint: "0:40"}
```

### discussion

- В понедельник купили 14 стаканов, а некоторые дети были без денег. Что
  мы узнали о спросе из продаж? Что лишь предположили со слов детей?
- Во вторник продажи и прибыль выросли. Что произошло с деньгами и
  долгами покупателей?
- Можно ли рассчитывать на 30 продаж каждый день после вторника? Какие
  условия того дня сохранились?
- В среду команды приготовили разный объём. Как это сказалось на
  результате? Что нужно знать, прежде чем покупать ещё один кувшин?
- В пятницу покупателей стало больше. Стало ли больше прибыли? Сколько
  стаканов нужно было продать по новой цене, чтобы её сохранить?
- Что можно предположить о возможностях двора по результатам недели?
  Какие данные нужны для решения о росте?
- Что ещё вы заметили?

### team

**Для разбора после обсуждения.** Если вы купили второй кувшин, во вторник
шестеро покупателей взяли в долг, хотя пришли бы и без отсрочки: четверо
вернули деньги. Ещё десятерых привлекла сама отсрочка; из них заплатили
трое. Выручка выросла сразу, а часть денег так и не поступила.

Для сравнения с четвергом предположим, что прежние 14 покупателей взяли
бы лимонад и без скидки. Снижение цены на одну монету обошлось бы в
14 монет; четыре продажи сверх вчерашних дали бы ещё 8 монет после оплаты
ингредиентов. Чтобы сохранить прибыль четверга, в пятницу нужно было
продать 21 стакан. Продали 18.

### trainer

Сначала соберите версии команд по вопросам, затем покажите ловушки.
Разбор расчётов есть на телефонах. Не называйте размер двора установленным
фактом: ровные продажи дают повод проверить ёмкость сегмента, но не
доказывают её.
