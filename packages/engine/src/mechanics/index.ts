// Реестр библиотеки механик v1.
import type { Mechanic, Stage } from "./contract.ts";
import { channel, creditSales, funnel, priceResponse } from "./demand.ts";
import { capex, financing, fixedCosts, projection } from "./finance.ts";
import { batchProduction, inventory, onDemandProduction } from "./supply.ts";

export const LIBRARY_MAJOR = 1;

export const MECHANICS: Record<string, Mechanic> = Object.fromEntries(
  [funnel, priceResponse, channel, creditSales, batchProduction, onDemandProduction, inventory, fixedCosts, capex, financing, projection].map((m) => [
    m.id,
    m,
  ]),
);

export function stageOf(m: Mechanic, rawParams: Record<string, unknown>): Stage {
  return typeof m.stage === "function" ? m.stage(rawParams) : m.stage;
}

export * from "./contract.ts";
