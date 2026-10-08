// Механики сбыта: возвращают allocation и проводки себестоимости.
// Выручку проводит движок на стадии settle (docs/mechanics.md, п. 3.1).
import { type Mechanic, allocate, demandOf, nonNegInt, str } from "./contract.ts";

export const batchProduction: Mechanic<{ quantity: number; unit_cost: number; source?: string }> = {
  id: "batch_production",
  major: 1,
  stage: "supply",
  paramsSchema: {
    type: "object",
    required: ["quantity", "unit_cost"],
    additionalProperties: false,
    properties: { quantity: nonNegInt, unit_cost: nonNegInt, source: str },
  },
  step(ctx, p) {
    const { units, sold } = allocate(ctx.trade, p.quantity);
    const waste = p.quantity - sold;
    return {
      allocation: { units, unit_cost: p.unit_cost, produced: p.quantity, waste_units: waste },
      transactions: [
        {
          source: p.source ?? "production",
          category: "operating",
          legs: [
            { account: "cogs", amount: sold * p.unit_cost },
            { account: "waste", amount: waste * p.unit_cost },
            { account: "cash", amount: -p.quantity * p.unit_cost },
          ],
        },
      ],
    };
  },
};

export const onDemandProduction: Mechanic<{ unit_cost: number; capacity?: number; source?: string }> = {
  id: "on_demand_production",
  major: 1,
  stage: "supply",
  paramsSchema: {
    type: "object",
    required: ["unit_cost"],
    additionalProperties: false,
    properties: { unit_cost: nonNegInt, capacity: nonNegInt, source: str },
  },
  step(ctx, p) {
    const { units, sold } = allocate(ctx.trade, p.capacity ?? demandOf(ctx.trade));
    return {
      allocation: { units, unit_cost: p.unit_cost, produced: sold, waste_units: 0 },
      transactions: [
        {
          source: p.source ?? "production",
          category: "operating",
          legs: [
            { account: "cogs", amount: sold * p.unit_cost },
            { account: "cash", amount: -sold * p.unit_cost },
          ],
        },
      ],
    };
  },
};

interface Shelf {
  units: number;
  unit_cost: number;
}

export const inventory: Mechanic<
  { mode: "stock"; units: number; unit_cost: number; source: string } | { mode: "sell"; unit_cost: number; restock?: boolean; source?: string } | { mode: "liquidate"; source: string },
  Shelf
> = {
  id: "inventory",
  major: 1,
  stage: (raw) => (raw.mode === "sell" ? "supply" : "finance"),
  paramsSchema: {
    type: "object",
    required: ["mode"],
    properties: { mode: { enum: ["stock", "sell", "liquidate"] } },
    oneOf: [
      {
        additionalProperties: false,
        required: ["units", "unit_cost", "source"],
        properties: { mode: { const: "stock" }, units: nonNegInt, unit_cost: nonNegInt, source: str },
      },
      {
        additionalProperties: false,
        required: ["unit_cost"],
        properties: { mode: { const: "sell" }, unit_cost: nonNegInt, restock: { type: "boolean" }, source: str },
      },
      {
        additionalProperties: false,
        required: ["source"],
        properties: { mode: { const: "liquidate" }, source: str },
      },
    ],
  },
  step(ctx, p, shelf = { units: 0, unit_cost: 0 }) {
    // v1: у одного запаса одна себестоимость единицы. Иначе стоимость остатка
    // на счёте inventory разошлась бы с числом единиц × их ценой.
    if ((p.mode === "stock" || p.mode === "sell") && shelf.units > 0 && p.unit_cost !== shelf.unit_cost)
      throw new Error(`unit_cost ${p.unit_cost} не совпадает с себестоимостью запаса ${shelf.unit_cost}: у одного запаса она одна`);
    if (p.mode === "stock") {
      const value = p.units * p.unit_cost;
      return {
        state: { units: shelf.units + p.units, unit_cost: p.unit_cost },
        transactions: [
          { source: p.source, category: "operating", legs: [{ account: "inventory", amount: value }, { account: "cash", amount: -value }] },
        ],
      };
    }
    if (p.mode === "liquidate") {
      const value = shelf.units * shelf.unit_cost;
      return {
        state: { units: 0, unit_cost: shelf.unit_cost },
        transactions: [
          { source: p.source, category: "operating", legs: [{ account: "cash", amount: value }, { account: "inventory", amount: -value }] },
        ],
        metrics: { units: shelf.units, amount: value },
      };
    }
    const { units, sold } = allocate(ctx.trade, shelf.units);
    const cost = sold * p.unit_cost;
    const txs = [
      { source: "sales", category: "operating" as const, legs: [{ account: "cogs", amount: cost }, { account: "inventory", amount: -cost }] },
    ];
    if (p.restock)
      txs.push({
        source: p.source ?? "restock",
        category: "operating",
        legs: [
          { account: "inventory", amount: cost },
          { account: "cash", amount: -cost },
        ],
      });
    return {
      allocation: { units, unit_cost: p.unit_cost, produced: sold, waste_units: 0 },
      state: { units: p.restock ? shelf.units : shelf.units - sold, unit_cost: shelf.unit_cost },
      transactions: txs,
    };
  },
};
