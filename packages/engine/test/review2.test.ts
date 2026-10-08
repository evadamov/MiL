// Регрессии по ревью коммита d8af829.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InputValueError, normalizeInput, runPath } from "../src/engine.ts";
import type { InputDef } from "../src/types.ts";
import { validateScenario } from "../src/validate.ts";
import { REPO, compileOk, oneStep, writeScenario } from "./helpers.ts";

const report = (files: Record<string, string>, id = "t") => {
  const { root, dir } = writeScenario(id, files);
  return validateScenario(dir, root);
};
const errorsOf = (files: Record<string, string>, id = "t") => report(files, id).diagnostics.filter((d) => d.severity === "error");

// funnel: 10 × 0.5 = 5 продаж по 10 при себестоимости 4 → 30; минус fixed 5 → 25.
const withCondition = (conditions: string, when: string, slots = "") =>
  oneStep(
    `duration: {min: 1, max: 1}
conditions:
${conditions}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}
  - use: fixed_costs
    when: ${when}
    params: {amount: 5, source: rent}`,
    "",
    slots,
  ).replace("expect: {at.s1.check.balance: 0}", "expect: {at.s1.pl.day: 25}");

describe("1. условие не выключает механику незаметно", () => {
  const SALES = "  has_sales: {expr: {\">\": [{var: at.s1.metrics.sold}, 0]}}";

  it("условие на продажи текущего шага в when механики — ошибка проверки, а не прибыль 30 вместо 25", () => {
    const errs = errorsOf({ "scenario.md": withCondition(SALES, "has_sales") });
    expect(errs.map((e) => e.code)).toContain("E041");
    const e = errs.find((x) => x.code === "E041")!;
    expect(e.message).toContain("условие has_sales используется при исполнении механики");
    expect(e.message).toContain("mechanics/2/when");
  });

  it("движок тоже не считает тихо: ссылка без значения в when — E041", () => {
    const sc = compileOk("t", { "scenario.md": withCondition(SALES, "has_sales").replace("expect: {at.s1.pl.day: 25}", "expect: {at.s1.check.balance: 0}") });
    expect(() => runPath(sc, {})).toThrow(expect.objectContaining({ code: "E041", pointer: "step:s1/mechanics/2/when" }));
  });

  it("то же условие допустимо там, где значение уже есть, — в тексте результатов", () => {
    const md = withCondition(SALES, "always", "\n### results (if has_sales)\n\nПродажи были.\n").replace("conditions:\n", "conditions:\n  always: {expr: true}\n");
    expect(errorsOf({ "scenario.md": md })).toEqual([]);
  });

  it("условие на прошлые шаги и ходы в when — без ошибок, механика исполняется", () => {
    const md = withCondition("  cheap: {expr: {\"<\": [{var: p.cost}, 10]}}", "cheap");
    expect(errorsOf({ "scenario.md": md })).toEqual([]);
  });

  it("цикл условий — ошибка с цепочкой, в проверке и в движке", () => {
    const md = withCondition("  a: b\n  b: a", "a");
    expect(errorsOf({ "scenario.md": md })).toContainEqual(expect.objectContaining({ code: "E040", message: "цикл условий: a → b → a" }));
    const sc = compileOk("t", { "scenario.md": md.replace("expect: {at.s1.pl.day: 25}", "expect: {at.s1.check.balance: 0}") });
    expect(() => runPath(sc, {})).toThrow(expect.objectContaining({ code: "E040", message: "цикл условий: a → b → a" }));
  });

  it("опечатка в переменной вывода — диагностика, а не тихое «ложно»", () => {
    const md = withCondition("  always: {expr: true}", "always").replace(
      "# checks",
      "# lessons\n\n## lesson l1 · Вывод\n\nТекст.\n\n```sim\nkind: path\nassert: {\">\": [{var: at.s1.pl.dya}, 0]}\n```\n\n# checks",
    );
    expect(errorsOf({ "scenario.md": md })).toContainEqual(expect.objectContaining({ code: "E070", message: expect.stringContaining("$at.s1.pl.dya") }));
  });
});

describe("2. переносы строк CRLF", () => {
  it("сценарий с CRLF компилируется и проверяется так же, как с LF", () => {
    const lf = fs.readFileSync(path.join(REPO, "scenarios/rink_tea/scenario.md"), "utf8").replace(/\r\n/g, "\n");
    const a = report({ "scenario.md": lf }, "rink_tea");
    const b = report({ "scenario.md": lf.replace(/\n/g, "\r\n") }, "rink_tea");
    expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(b.checks).toEqual(a.checks);
    expect(b.lessons).toEqual(a.lessons);
  });
});

describe("3. одна проверка числового хода", () => {
  const num: InputDef = { id: "n", type: "number", label: "Сколько", min: 0, max: 10, step: 1, samples: [1], default: 1 };

  it.each([
    [2.5, "шаг 1"],
    [Number.NaN, "нужно число"],
    [Number.POSITIVE_INFINITY, "нужно число"],
    ["abc", "нужно число"],
    [11, "не больше 10"],
    [-1, "не меньше 0"],
  ])("%s отклоняется: %s", (raw, msg) => {
    expect(() => normalizeInput(num, raw)).toThrow(InputValueError);
    expect(() => normalizeInput(num, raw)).toThrow(msg);
  });

  it("строки с запятой и числа принимаются одинаково", () => {
    expect(normalizeInput(num, "3")).toBe(3);
    expect(normalizeInput({ ...num, step: 0.5 }, "2,5")).toBe(2.5);
  });

  it("runPath отклоняет ход, который отклонила бы веб-форма", () => {
    const sc = compileOk("t", {
      "scenario.md": oneStep(`duration: {min: 1, max: 1}
inputs:
  - {id: n, type: number, label: Сколько, min: 0, max: 10, step: 1, samples: [1], default: 1}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: batch_production
    params: {quantity: $input.n, unit_cost: 4}`),
    });
    expect(() => runPath(sc, { "s1.n": 2.5 })).toThrow(expect.objectContaining({ code: "E071", message: expect.stringContaining("шаг 1") }));
    expect(runPath(sc, { "s1.n": 3 }).at.s1.metrics.sold).toBe(3);
  });
});
