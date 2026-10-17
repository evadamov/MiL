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
