// Контракт механики — docs/mechanics.md, п. 1–3.
import type { Transaction } from "../ledger.ts";
import { roundHalfUp } from "../logic.ts";

export type Stage = "finance" | "demand" | "supply" | "costs" | "analysis";
export const STAGE_ORDER: Stage[] = ["finance", "demand", "supply", "costs", "analysis"];

export interface Segment {
  id: string;
  size: number;
  price?: number;
  pay: "cash" | "credit";
  return_rate?: number;
  collect_at?: string;
}

export interface TradeContext {
  traffic?: number;
  conversion?: number;
  price?: number;
  queue: Segment[];
}

export interface Allocation {
  units: Record<string, number>;
  unit_cost: number;
  produced: number;
  waste_units: number;
}

export interface MechanicContext {
  stepId: string;
  trade: Readonly<TradeContext>;
  balances: Readonly<Record<string, number>>;
  now?: unknown;
}

export interface MechanicResult<S = unknown> {
  transactions?: Transaction[];
  metrics?: Record<string, unknown>;
  trade?: Partial<TradeContext>;
  allocation?: Allocation;
  state?: S;
}

export interface Mechanic<P = any, S = any> {
  id: string;
  major: number;
  /** Стадия может зависеть от литерального режима (inventory.mode). */
  stage: Stage | ((rawParams: Record<string, unknown>) => Stage);
  paramsSchema: object;
  step(ctx: MechanicContext, params: P, state: S | undefined): MechanicResult<S>;
}

/** Спрос шага: сумма сегментов очереди. */
export function demandOf(trade: Readonly<TradeContext>): number {
  return trade.queue.reduce((s, x) => s + x.size, 0);
}

/** Разбор очереди сверху вниз, пока хватает продукта. */
export function allocate(trade: Readonly<TradeContext>, available: number): { units: Record<string, number>; sold: number } {
  let left = available;
  const units: Record<string, number> = {};
  let sold = 0;
  for (const seg of trade.queue) {
    const n = Math.max(0, Math.min(seg.size, left));
    if (n > 0) units[seg.id] = (units[seg.id] ?? 0) + n;
    left -= n;
    sold += n;
  }
  return { units, sold };
}

export { roundHalfUp };

export const int = { type: "integer" } as const;
export const nonNegInt = { type: "integer", minimum: 0 } as const;
export const share = { type: "number", minimum: 0, maximum: 1 } as const;
export const str = { type: "string", minLength: 1 } as const;
