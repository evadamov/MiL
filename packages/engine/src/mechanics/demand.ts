// Механики стадии demand: funnel, price_response, channel, credit_sales.
import { type Mechanic, nonNegInt, share, str } from "./contract.ts";

export const funnel: Mechanic<{ traffic: number; conversion?: number; price?: number }> = {
  id: "funnel",
  major: 1,
  stage: "demand",
  paramsSchema: {
    type: "object",
    required: ["traffic"],
    additionalProperties: false,
    properties: { traffic: nonNegInt, conversion: share, price: nonNegInt },
  },
  step(_ctx, p) {
    return { trade: { traffic: p.traffic, conversion: p.conversion, price: p.price } };
  },
};

export const priceResponse: Mechanic<{ price: number; table: { price: number; conversion: number }[] }> = {
  id: "price_response",
  major: 1,
  stage: "demand",
  paramsSchema: {
    type: "object",
    required: ["price", "table"],
    additionalProperties: false,
    properties: {
      price: nonNegInt,
      table: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["price", "conversion"],
          additionalProperties: false,
          properties: { price: nonNegInt, conversion: share },
        },
      },
    },
  },
  step(_ctx, p) {
    const row = p.table.find((r) => r.price === p.price);
    if (!row) throw new Error(`цены ${p.price} нет в таблице price_response`);
    return { trade: { price: p.price, conversion: row.conversion } };
  },
};

type Tier = { key: string | number; cost: number; traffic_add: number };

export const channel: Mechanic<{
  choice: string | number;
  tiers: Tier[];
  conversion_by_key?: Record<string, number>;
  source?: string;
}> = {
  id: "channel",
  major: 1,
  stage: "demand",
  paramsSchema: {
    type: "object",
    required: ["choice", "tiers"],
    additionalProperties: false,
    properties: {
      choice: { type: ["string", "integer"] },
      tiers: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["key", "cost", "traffic_add"],
          additionalProperties: false,
          properties: { key: { type: ["string", "integer"] }, cost: nonNegInt, traffic_add: nonNegInt },
        },
      },
      conversion_by_key: { type: "object", additionalProperties: share },
      source: str,
    },
  },
  step(ctx, p) {
    const tier = p.tiers.find((t) => t.key === p.choice);
    if (!tier) throw new Error(`тира ${p.choice} нет в tiers`);
    if (ctx.trade.traffic === undefined) throw new Error("channel без трафика: в шаге нет funnel");
    const conv = p.conversion_by_key?.[String(p.choice)];
    return {
      trade: { traffic: ctx.trade.traffic + tier.traffic_add, ...(conv !== undefined ? { conversion: conv } : {}) },
      transactions: tier.cost
        ? [
            {
              source: p.source ?? "marketing",
              category: "operating",
              legs: [
                { account: "marketing", amount: tier.cost },
                { account: "cash", amount: -tier.cost },
              ],
            },
          ]
        : [],
      metrics: { cost: tier.cost, traffic_add: tier.traffic_add },
    };
  },
};

const segmentSchema = {
  type: "object",
  required: ["id", "size", "pay"],
  additionalProperties: false,
  properties: {
    id: str,
    size: nonNegInt,
    price: nonNegInt,
    pay: { enum: ["cash", "credit"] },
    return_rate: share,
    collect_at: str,
  },
  if: { properties: { pay: { const: "credit" } } },
  then: { required: ["return_rate", "collect_at"] },
} as const;

export const creditSales: Mechanic<{ traffic?: number; price?: number; segments: any[] }> = {
  id: "credit_sales",
  major: 1,
  stage: "demand",
  paramsSchema: {
    type: "object",
    required: ["segments"],
    additionalProperties: false,
    properties: { traffic: nonNegInt, price: nonNegInt, segments: { type: "array", minItems: 1, items: segmentSchema } },
  },
  step(ctx, p) {
    return {
      trade: {
        ...(p.traffic !== undefined ? { traffic: p.traffic } : {}),
        ...(p.price !== undefined ? { price: p.price } : {}),
        queue: [...ctx.trade.queue, ...p.segments],
      },
    };
  },
};
