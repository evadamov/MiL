// Исполнение шага на синтетических сценариях.
import { describe, expect, it } from "vitest";
import { EngineError, runPath } from "../src/engine.ts";
import { compileOk } from "./helpers.ts";

const twoSteps = (sell: string, collectBlock: string) => `---
id: t
version: 1
title: Тест
locale: ru
duration_min: 60
format: 1
library: 1
---

\`\`\`sim
currency: {label: монет}
params: {}
reference: ref
\`\`\`

# phase main · Фаза

## step sell · Продажа

\`\`\`sim
${sell}
\`\`\`

## step collect · Возврат

\`\`\`sim
${collectBlock}
\`\`\`

# checks

## check ref · Эталон

\`\`\`sim
expect: {at.collect.check.balance: 0}
\`\`\`
`;

const SELL = `duration: {min: 1, max: 1}
inputs:
  - {id: qty, type: number, label: Сколько, min: 0, max: 100, samples: [10, 20], default: 20}
  - {id: guess, type: quiz, label: Угадай, answer: 1}
mechanics:
  - use: credit_sales
    params:
      traffic: 30
      price: 10
      segments:
        - {id: payers, size: 8, pay: cash}
        - {id: debtors, size: 10, pay: credit, return_rate: 0.3, collect_at: collect}
  - use: batch_production
    params: {quantity: $input.qty, unit_cost: 4}`;

describe("движок", () => {
  it("settle: выручка по сегментам ведёт движок; долг возвращается на шаге collect_at", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL, "duration: {min: 1, max: 1}") });
    const r = runPath(sc, {});
    const sell = r.at.sell;
    expect(sell.metrics).toMatchObject({ traffic: 30, demand: 18, sold: 18, sold_cash: 8, sold_credit: 10, waste_units: 2 });
    expect(sell.pl.lines).toEqual({ revenue: 180, cogs: 72, waste: 8 });
    expect(sell.balance.receivables).toBe(100);
    expect(sell.cash).toBe(80 - 80);
    const collect = r.at.collect;
    expect(collect.metrics.collections).toMatchObject({ returned: 3, written_off: 7, returned_amount: 30, written_off_amount: 70 });
    expect(collect.pl.lines).toEqual({ bad_debt: 70 });
    expect(collect.balance.receivables).toBe(0);
    expect(collect.cash).toBe(30);
    expect(collect.check.balance).toBe(0);
  });

  it("очередь разбирается сверху вниз: при нехватке долг не продаётся", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL, "duration: {min: 1, max: 1}") });
    const r = runPath(sc, { "sell.qty": 10 });
    expect(r.at.sell.metrics).toMatchObject({ sold: 10, sold_cash: 8, sold_credit: 2 });
    expect(r.at.collect.metrics.collections).toMatchObject({ returned: 1, written_off: 1 });
  });

  it("решение без ответа получает default, квиз — null", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL, "duration: {min: 1, max: 1}") });
    const r = runPath(sc, {});
    expect(r.inputs.sell).toEqual({ qty: 20, guess: null });
    expect(runPath(sc, { "sell.guess": 5 }).inputs.sell.guess).toBe(5);
  });

  it("ход вне диапазона и чужой вариант — ошибка исполнения", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL, "duration: {min: 1, max: 1}") });
    expect(() => runPath(sc, { "sell.qty": 500 })).toThrow(EngineError);
  });

  it("E046: collect_at не позже шага продажи", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL.replace("collect_at: collect", "collect_at: sell"), "duration: {min: 1, max: 1}") });
    expect(() => runPath(sc, {})).toThrow(expect.objectContaining({ code: "E046" }));
  });

  it("E032: две механики сбыта в шаге; E033: спрос без сбыта", () => {
    const two = SELL + `\n  - use: on_demand_production\n    params: {unit_cost: 1}`;
    expect(() => runPath(compileOk("t", { "scenario.md": twoSteps(two, "duration: {min: 1, max: 1}") }), {})).toThrow(expect.objectContaining({ code: "E032" }));
    const none = `duration: {min: 1, max: 1}\nmechanics:\n  - use: funnel\n    params: {traffic: 10, conversion: 0.5, price: 3}`;
    expect(() => runPath(compileOk("t", { "scenario.md": twoSteps(none, "duration: {min: 1, max: 1}") }), {})).toThrow(expect.objectContaining({ code: "E033" }));
  });

  it("параметры механики проверяются после подстановки: E031 с указателем", () => {
    const bad = `duration: {min: 1, max: 1}\nmechanics:\n  - use: fixed_costs\n    params: {amount: {expr: {"/": [7, 2]}}, source: rent}`;
    try {
      runPath(compileOk("t", { "scenario.md": twoSteps(bad, "duration: {min: 1, max: 1}") }), {});
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "E031", pointer: "step:sell/mechanics/0/params/amount" });
    }
  });

  it("детерминизм: одинаковые ходы — одинаковый результат", () => {
    const sc = compileOk("t", { "scenario.md": twoSteps(SELL, "duration: {min: 1, max: 1}") });
    expect(JSON.stringify(runPath(sc, { "sell.qty": 10 }))).toBe(JSON.stringify(runPath(sc, { "sell.qty": 10 })));
  });
});
