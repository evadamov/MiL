// Механики денег и расходов: fixed_costs, capex, financing, и анализ: projection.
import { ACCOUNTS } from "../ledger.ts";
import { type Mechanic, nonNegInt, roundHalfUp, share, str } from "./contract.ts";

const accountOf = (type: string) => ({ enum: Object.keys(ACCOUNTS).filter((a) => ACCOUNTS[a] === type) });

export const fixedCosts: Mechanic<{ amount: number; account?: string; source: string }> = {
  id: "fixed_costs",
  major: 1,
  stage: "costs",
  paramsSchema: {
    type: "object",
    required: ["amount", "source"],
    additionalProperties: false,
    properties: { amount: nonNegInt, account: accountOf("expense"), source: str },
  },
  step(_ctx, p) {
    return {
      transactions: [
        {
          source: p.source,
          category: "operating",
          legs: [
            { account: p.account ?? "fixed_costs", amount: p.amount },
            { account: "cash", amount: -p.amount },
          ],
        },
      ],
    };
  },
};

export const capex: Mechanic<{ amount: number; account?: string; source: string }> = {
  id: "capex",
  major: 1,
  stage: "finance",
  paramsSchema: {
    type: "object",
    required: ["amount", "source"],
    additionalProperties: false,
    properties: { amount: nonNegInt, account: accountOf("asset"), source: str },
  },
  step(_ctx, p) {
    return {
      transactions: [
        {
          source: p.source,
          category: "investing",
          legs: [
            { account: p.account ?? "equipment", amount: p.amount },
            { account: "cash", amount: -p.amount },
          ],
        },
      ],
    };
  },
};

export const financing: Mechanic<{ amount: number; account?: string; source: string }> = {
  id: "financing",
  major: 1,
  stage: "finance",
  paramsSchema: {
    type: "object",
    required: ["amount", "source"],
    additionalProperties: false,
    properties: { amount: nonNegInt, account: accountOf("liability"), source: str },
  },
  step(_ctx, p) {
    // Заём: деньги дебетом, обязательство кредитом — cash +amount, loan −amount.
    return {
      transactions: [
        {
          source: p.source,
          category: "financing",
          legs: [
            { account: "cash", amount: p.amount },
            { account: p.account ?? "loan", amount: -p.amount },
          ],
        },
      ],
    };
  },
};

type Base = { id: string; label: string; profit: number | { period: string } | { average: "periods" } };

export const projection: Mechanic<{
  unit_price: number;
  unit_cost: number;
  period_cost: number;
  periods: { id: string; label: string; traffic: number; conversion: number }[];
  goal: number;
  current: number;
  bases: Base[];
}> = {
  id: "projection",
  major: 1,
  stage: "analysis",
  paramsSchema: {
    type: "object",
    required: ["unit_price", "unit_cost", "period_cost", "periods", "goal", "current", "bases"],
    additionalProperties: false,
    properties: {
      unit_price: { type: "integer" },
      unit_cost: { type: "integer" },
      period_cost: { type: "integer" },
      goal: { type: "integer" },
      current: { type: "integer" },
      periods: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "label", "traffic", "conversion"],
          additionalProperties: false,
          properties: { id: str, label: str, traffic: nonNegInt, conversion: share },
        },
      },
      bases: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "label", "profit"],
          additionalProperties: false,
          properties: {
            id: str,
            label: str,
            profit: {
              oneOf: [
                { type: "integer" },
                { type: "object", required: ["period"], additionalProperties: false, properties: { period: str } },
                { type: "object", required: ["average"], additionalProperties: false, properties: { average: { const: "periods" } } },
              ],
            },
          },
        },
      },
    },
  },
  step(_ctx, p) {
    const periods = p.periods.map((x) => {
      const sold = roundHalfUp(x.traffic * x.conversion);
      return { ...x, sold, profit: sold * (p.unit_price - p.unit_cost) - p.period_cost };
    });
    const total = periods.reduce((s, x) => s + x.profit, 0);
    const average = roundHalfUp(total / periods.length);
    const remaining = Math.max(p.goal - p.current, 0);
    const bases = p.bases.map((b) => {
      let profit: number;
      if (typeof b.profit === "number") profit = b.profit;
      else if ("period" in b.profit) {
        const id = b.profit.period;
        const found = periods.find((x) => x.id === id);
        if (!found) throw new Error(`периода ${id} нет в periods`);
        profit = found.profit;
      } else profit = average;
      return { id: b.id, label: b.label, profit, horizon: profit > 0 ? roundHalfUp(remaining / profit) : null };
    });
    return {
      metrics: {
        periods,
        total,
        average,
        current: p.current,
        remaining,
        bases,
        horizon: Object.fromEntries(bases.map((b) => [b.id, b.horizon])),
      },
    };
  },
};
