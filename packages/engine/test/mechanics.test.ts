// Механики на синтетических числах, без сценариев из репозитория.
import { describe, expect, it } from "vitest";
import { MECHANICS, type TradeContext } from "../src/mechanics/index.ts";
import { roundHalfUp } from "../src/logic.ts";

const ctx = (trade: Partial<TradeContext> = {}) => ({ stepId: "s", trade: { queue: [], ...trade }, balances: {} });
const sum = (legs: { amount: number }[]) => legs.reduce((s, l) => s + l.amount, 0);

describe("механики v1", () => {
  it("каждая транзакция каждой механики сбалансирована", () => {
    const q = { queue: [{ id: "all", size: 7, pay: "cash" as const }], traffic: 10, price: 5 };
    const cases: [string, object, unknown?][] = [
      ["channel", { choice: 2, tiers: [{ key: 2, cost: 9, traffic_add: 3 }] }],
      ["batch_production", { quantity: 10, unit_cost: 3 }],
      ["on_demand_production", { unit_cost: 3 }],
      ["inventory", { mode: "stock", units: 5, unit_cost: 2, source: "x" }],
      ["inventory", { mode: "sell", unit_cost: 2, restock: true }, { units: 5, unit_cost: 2 }],
      ["inventory", { mode: "liquidate", source: "x" }, { units: 5, unit_cost: 2 }],
      ["fixed_costs", { amount: 11, source: "x" }],
      ["capex", { amount: 11, source: "x" }],
      ["financing", { amount: 11, source: "x" }],
    ];
    for (const [id, params, state] of cases) {
      const res = MECHANICS[id].step(ctx(q), params, state);
      for (const tx of res.transactions ?? []) expect(sum(tx.legs), `${id} ${JSON.stringify(params)}`).toBe(0);
    }
  });

  it("сбыт не проводит выручку: только себестоимость и allocation", () => {
    const res = MECHANICS.batch_production.step(ctx({ queue: [{ id: "a", size: 4, pay: "cash" }, { id: "b", size: 10, pay: "credit", return_rate: 0.5, collect_at: "x" }] }), { quantity: 9, unit_cost: 2 }, undefined);
    expect(res.allocation).toEqual({ units: { a: 4, b: 5 }, unit_cost: 2, produced: 9, waste_units: 0 });
    const accounts = res.transactions!.flatMap((t) => t.legs.map((l) => l.account));
    expect(accounts).not.toContain("revenue");
    expect(accounts).not.toContain("receivables");
  });

  it("batch_production списывает непроданное", () => {
    const res = MECHANICS.batch_production.step(ctx({ queue: [{ id: "all", size: 6, pay: "cash" }] }), { quantity: 10, unit_cost: 3 }, undefined);
    expect(res.allocation!.waste_units).toBe(4);
    expect(res.transactions![0].legs).toEqual([
      { account: "cogs", amount: 18 },
      { account: "waste", amount: 12 },
      { account: "cash", amount: -30 },
    ]);
  });

  it("financing: cash +amount, loan −amount", () => {
    const res = MECHANICS.financing.step(ctx(), { amount: 500, source: "x" }, undefined);
    expect(res.transactions![0].legs).toEqual([
      { account: "cash", amount: 500 },
      { account: "loan", amount: -500 },
    ]);
  });

  it("channel добавляет трафик и, если задано, меняет конверсию", () => {
    const tiers = [{ key: 0, cost: 0, traffic_add: 0 }, { key: 1, cost: 5, traffic_add: 20 }];
    const res = MECHANICS.channel.step(ctx({ traffic: 100, conversion: 0.1 }), { choice: 1, tiers, conversion_by_key: { "1": 0.2 } }, undefined);
    expect(res.trade).toEqual({ traffic: 120, conversion: 0.2 });
    expect(MECHANICS.channel.step(ctx({ traffic: 100 }), { choice: 0, tiers }, undefined).transactions).toEqual([]);
  });

  it("inventory: продажи ограничены полкой, restock сохраняет запас", () => {
    const shelf = { units: 3, unit_cost: 2 };
    const sold = MECHANICS.inventory.step(ctx({ queue: [{ id: "all", size: 5, pay: "cash" }] }), { mode: "sell", unit_cost: 2 }, shelf);
    expect(sold.allocation!.units).toEqual({ all: 3 });
    expect(sold.state).toEqual({ units: 0, unit_cost: 2 });
    const restocked = MECHANICS.inventory.step(ctx({ queue: [{ id: "all", size: 2, pay: "cash" }] }), { mode: "sell", unit_cost: 2, restock: true }, shelf);
    expect(restocked.state).toEqual(shelf);
  });

  it("projection: периоды, средняя, горизонт с округлением половина вверх", () => {
    const res = MECHANICS.projection.step(
      ctx(),
      {
        unit_price: 10,
        unit_cost: 4,
        period_cost: 20,
        periods: [
          { id: "a", label: "A", traffic: 10, conversion: 0.5 },
          { id: "b", label: "B", traffic: 30, conversion: 0.5 },
        ],
        goal: 300,
        current: 50,
        bases: [
          { id: "avg", label: "Средняя", profit: { average: "periods" } },
          { id: "a", label: "A", profit: { period: "a" } },
          { id: "zero", label: "Ноль", profit: 0 },
        ],
      },
      undefined,
    );
    const m = res.metrics as any;
    expect(m.periods.map((p: any) => p.profit)).toEqual([10, 70]);
    expect(m.average).toBe(40);
    expect(m.remaining).toBe(250);
    expect(m.horizon).toEqual({ avg: 6, a: 25, zero: null });
  });

  it("roundHalfUp: 37.5 → 38, 62.5 → 63, 2.4999 → 2", () => {
    expect(roundHalfUp(150 * 0.25)).toBe(38);
    expect(roundHalfUp(250 * 0.25)).toBe(63);
    expect(roundHalfUp(2.4999)).toBe(2);
  });
});
