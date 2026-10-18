// По итогам прогона с заказчиком: подписи счетов по фазам, own_use в партии.
import { describe, expect, it } from "vitest";
import { validateScenario } from "../src/validate.ts";
import { runPath } from "../src/engine.ts";
import { compileOk, oneStep, writeScenario } from "./helpers.ts";

const STEP = `duration: {min: 1, max: 1}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}`;
const errorsOf = (extraRoot: string) => {
  const { root, dir } = writeScenario("t", { "scenario.md": oneStep(STEP, extraRoot) });
  return validateScenario(dir, root).diagnostics.filter((d) => d.severity === "error");
};

describe("accounts.by_phase", () => {
  it("известная фаза — без ошибок", () => {
    expect(errorsOf("accounts:\n  cogs: {label: Себестоимость, by_phase: {main: Платёж маме}}")).toEqual([]);
  });
  it("неизвестная фаза — E040", () => {
    expect(errorsOf("accounts:\n  cogs: {label: Себестоимость, by_phase: {yard: Платёж маме}}")).toEqual([
      expect.objectContaining({ code: "E040", message: "accounts.cogs.by_phase: нет фазы yard" }),
    ]);
  });
});

describe("batch_production.own_use", () => {
  const run = (ownUse: number, demand = 8) => {
    const md = oneStep(`duration: {min: 1, max: 1}
mechanics:
  - use: funnel
    params: {traffic: ${demand}, conversion: 1, price: 5}
  - use: batch_production
    params: {quantity: 10, own_use: ${ownUse}, unit_cost: 2}`);
    const { root, dir } = writeScenario("t", { "scenario.md": md });
    return validateScenario(dir, root);
  };
  it("в продажу идёт quantity − own_use, own_use — в списания", () => {
    const sc = compileOk("t", { "scenario.md": oneStep(`duration: {min: 1, max: 1}
mechanics:
  - use: funnel
    params: {traffic: 12, conversion: 1, price: 5}
  - use: batch_production
    params: {quantity: 10, own_use: 1, unit_cost: 2}`) });
    const s = runPath(sc, {}).at.s1;
    expect(s.metrics.sold).toBe(9);
    expect(s.metrics.waste_units).toBe(1);
    expect(s.pl.lines).toMatchObject({ cogs: 18, waste: 2 });
    expect(s.cash).toBe(9 * 5 - 20);
  });
  it("own_use больше партии — ошибка", () => {
    expect(run(11).diagnostics.filter((d) => d.severity === "error")[0]?.message).toContain("own_use 11 больше партии 10");
  });
});

describe("проверки после прогона 1", () => {
  const CHOICE = `duration: {min: 1, max: 1}
inputs:
  - {id: c, type: choice, label: Выбор, options: [{value: 5, label: дёшево}, {value: 9, label: дорого}], default: 5}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: $input.c}
  - use: on_demand_production
    params: {unit_cost: 4}`;
  const report = (md: string) => {
    const { root, dir } = writeScenario("t", { "scenario.md": md });
    return validateScenario(dir, root).diagnostics;
  };

  it("W081: число в общем тексте зависит от хода", () => {
    const d = report(oneStep(CHOICE, "", "\n### results\n\nВыручка {{pl.lines.revenue}}, людей {{metrics.traffic}}.\n"));
    expect(d.filter((x) => x.code === "W081").map((x) => x.message)).toEqual([expect.stringContaining("{{pl.lines.revenue}}")]);
  });

  it("W081 не срабатывает на условный вариант текста", () => {
    const md = oneStep(CHOICE.replace("inputs:", "conditions:\n  cheap: {expr: {\"==\": [{var: input.c}, 5]}}\ninputs:"), "", "\n### results (if cheap)\n\nВыручка {{pl.lines.revenue}}.\n\n### results\n\nГотово.\n");
    expect(report(md).filter((x) => x.code === "W081")).toEqual([]);
  });

  it("sources.by_phase с неизвестной фазой — E040; actual — только у forecast", () => {
    expect(report(oneStep(STEP, "sources:\n  x: {label: X, by_phase: {nope: Y}}")).filter((x) => x.severity === "error")[0]?.message).toBe("sources.x.by_phase: нет фазы nope");
    const bad = oneStep(CHOICE.replace("default: 5}", "default: 5, actual: 1}"));
    expect(report(bad).some((x) => x.code === "E021")).toBe(true);
  });
});
