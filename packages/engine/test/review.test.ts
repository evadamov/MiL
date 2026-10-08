// Регрессии по ревью коммита 78d7c28: случаи, где сценарий формально проходил
// проверку, а результат был неверным, — или где проверка падала со стеком.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPath } from "../src/engine.ts";
import { evalLogic, LogicError } from "../src/logic.ts";
import { MECHANICS } from "../src/mechanics/index.ts";
import { validateScenario } from "../src/validate.ts";
import { REPO, compileOk, oneStep, writeScenario } from "./helpers.ts";

const errorsOf = (files: Record<string, string>, id = "t") => {
  const { root, dir } = writeScenario(id, files);
  return validateScenario(dir, root).diagnostics.filter((d) => d.severity === "error");
};

describe("1. повтор id сегмента", () => {
  const block = `duration: {min: 1, max: 1}
mechanics:
  - use: credit_sales
    params:
      traffic: 40
      price: 1
      segments:
        - {id: a, size: 15, pay: cash}
        - {id: a, size: 15, pay: cash}
  - use: on_demand_production
    params: {unit_cost: 0}`;

  it("движок отвергает очередь с повторяющимися id, а не удваивает выручку", () => {
    const sc = compileOk("t", { "scenario.md": oneStep(block) });
    expect(() => runPath(sc, {})).toThrow(expect.objectContaining({ code: "E031", message: expect.stringContaining("повтор id сегмента «a»") }));
  });

  it("и проверка сценария это показывает", () => {
    expect(errorsOf({ "scenario.md": oneStep(block) }).map((d) => d.code)).toContain("E031");
  });
});

describe("2. себестоимость запаса", () => {
  it("продажа с другим unit_cost, чем у запаса, — ошибка (было: остаток 5 шт. по 4, а на счёте 15)", () => {
    const shelf = { units: 10, unit_cost: 4 };
    const trade = { queue: [{ id: "all", size: 5, pay: "cash" as const }] };
    expect(() => MECHANICS.inventory.step({ stepId: "s", trade, balances: {} }, { mode: "sell", unit_cost: 5 }, shelf)).toThrow(/не совпадает с себестоимостью запаса 4/);
    expect(() => MECHANICS.inventory.step({ stepId: "s", trade, balances: {} }, { mode: "stock", units: 3, unit_cost: 5, source: "x" }, shelf)).toThrow(/не совпадает/);
  });

  it("в сценарии: запас 10 по 4, продажа по 5 — диагностика, а не тихий расхождение", () => {
    const md = oneStep(`duration: {min: 1, max: 1}
mechanics:
  - use: inventory
    id: goods
    params: {mode: stock, units: 10, unit_cost: 4, source: buy}
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 9}
  - use: inventory
    id: goods
    params: {mode: sell, unit_cost: 5}`);
    expect(errorsOf({ "scenario.md": md }).map((d) => d.code)).toContain("E031");
  });

  it("при одной себестоимости остаток на счёте = единицы × цена", () => {
    const sc = compileOk("t", {
      "scenario.md": oneStep(`duration: {min: 1, max: 1}
mechanics:
  - use: inventory
    id: goods
    params: {mode: stock, units: 10, unit_cost: 4, source: buy}
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 9}
  - use: inventory
    id: goods
    params: {mode: sell, unit_cost: 4}`),
    });
    expect(runPath(sc, {}).at.s1.balance.inventory).toBe(5 * 4);
  });
});

describe("3. вводная не видит будущих ходов", () => {
  // Переносы нормализуются: в checkout на Windows файл может быть с CRLF.
  const tea = fs.readFileSync(path.join(REPO, "scenarios/rink_tea/scenario.md"), "utf8").replace(/\r\n/g, "\n");

  it("{{inputs.sun.thermoses}} во вводной пятницы — E080", () => {
    const md = tea.replace("Пятница: катаются в основном после работы.", "Пятница: в воскресенье заварим {{inputs.sun.thermoses}}.");
    const errs = errorsOf({ "scenario.md": md }, "rink_tea");
    expect(errs).toEqual([expect.objectContaining({ code: "E080", message: expect.stringContaining("inputs.sun.thermoses") })]);
  });

  it("и в тексте результатов — ни будущих ходов, ни будущих снимков", () => {
    const md = tea.replace("### debrief\n\nТермос", "### results\n\nВ воскресенье: {{inputs.sun.thermoses}}, {{at.sun.cash}}.\n\n### debrief\n\nТермос");
    const codes = errorsOf({ "scenario.md": md }, "rink_tea").map((d) => d.message);
    expect(codes.some((m) => m.includes("inputs.sun.thermoses"))).toBe(true);
    expect(codes.some((m) => m.includes("at.sun.cash"))).toBe(true);
  });

  it("свои и прошлые ходы в результатах доступны", () => {
    const md = tea.replace("### debrief\n\nКто заварил", "### results\n\nСегодня {{input.thermoses}}, в субботу {{inputs.sat.thermoses}}.\n\n### debrief\n\nКто заварил");
    expect(errorsOf({ "scenario.md": md }, "rink_tea")).toEqual([]);
  });
});

describe("4. операции в выражениях", () => {
  const md = (assert: string) =>
    oneStep(
      `duration: {min: 1, max: 1}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}`,
      "",
      `
# lessons

## lesson l1 · Вывод

Текст.

\`\`\`sim
kind: path
assert: ${assert}
\`\`\`
`,
    );

  it("неизвестная операция — диагностика с файлом и строкой, а не стек", () => {
    const text = md("{not_a_logic_operator: [1, 2]}");
    const [e] = errorsOf({ "scenario.md": text });
    expect(e).toMatchObject({ code: "E040", message: expect.stringContaining("неизвестная операция «not_a_logic_operator»") });
    expect(e.pos!.line).toBe(text.split("\n").findIndex((l) => l.includes("not_a_logic_operator")) + 1);
  });

  it("встроенная log запрещена и в движке не работает", () => {
    expect(errorsOf({ "scenario.md": md("{log: [1]}") })[0].message).toContain("«log»");
    expect(() => evalLogic({ log: [1] }, {})).toThrow(LogicError);
  });

  it("то же в выражении параметра механики", () => {
    const text = oneStep(`duration: {min: 1, max: 1}
mechanics:
  - use: fixed_costs
    params: {amount: {expr: {pow: [2, 3]}}, source: x}`);
    expect(errorsOf({ "scenario.md": text })[0]).toMatchObject({ code: "E040", message: expect.stringContaining("«pow»") });
  });
});

describe("5. покрытие и пустые выводы", () => {
  it("лимонад: 2304 пути из 31 104 сочетаний, prep — по samples, 6 из 81", () => {
    const rep = validateScenario(path.join(REPO, "scenarios/lemonade"), REPO);
    expect(rep.paths).toBe(2304);
    expect(rep.space).toBe(31104);
    expect(rep.partialInputs).toEqual([{ key: "d14_order.prep", samples: 6, values: 81 }]);
  });

  it("вывод без единой подходящей пары путей — ошибка", () => {
    const text = oneStep(
      `duration: {min: 1, max: 1}
inputs:
  - {id: c, type: choice, label: Выбор, options: [{value: 1, label: a}, {value: 2, label: b}], default: 1}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}`,
      "",
      `
# lessons

## lesson never · Вывод, который не проверить

Текст.

\`\`\`sim
kind: contrast
contrast: {input: s1.c, a: 1, b: 2, where: {expr: {"==": [1, 2]}}}
assert: true
\`\`\`
`,
    );
    expect(errorsOf({ "scenario.md": text })).toEqual([expect.objectContaining({ code: "E070", message: expect.stringContaining("не проверен") })]);
  });
});

