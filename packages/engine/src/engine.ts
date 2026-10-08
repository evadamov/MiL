// Исполнение сценария: runPath — один путь (одна команда), шаг за шагом.
// Стадии шага: scheduled → finance → demand → [спрос] → supply → settle → costs → analysis.
// docs/engine.md, п. 2–4; docs/mechanics.md, п. 2–3.
import { Ajv, type ValidateFunction } from "ajv";
import { Ledger, LedgerError, balanceCheck, cashBySource, pnlLines, profit, type JournalEntry, type Transaction } from "./ledger.ts";
import { RefError, evalLogic, resolveValue, roundHalfUp } from "./logic.ts";
import { MECHANICS, STAGE_ORDER, demandOf, stageOf, type Allocation, type Segment, type TradeContext } from "./mechanics/index.ts";
import type { Condition, Decisions, InputDef, Json, Scenario, StepDef } from "./types.ts";

export interface Snapshot {
  input: Record<string, string | number | null>;
  metrics: Record<string, unknown>;
  pl: { day: number; phase: number; cumulative: number; lines: Record<string, number> };
  cf: Record<string, number>;
  cash: number;
  balance: Record<string, number>;
  check: { balance: number };
}

export interface PathResult {
  decisions: Decisions;
  /** Ходы по шагам с подставленными значениями по умолчанию. */
  inputs: Record<string, Record<string, string | number | null>>;
  at: Record<string, Snapshot>;
  order: string[];
  journal: JournalEntry[];
}

/** Ошибка исполнения на конкретном шаге — валидатор превращает её в диагностику. */
export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public step: string,
    public pointer?: string,
  ) {
    super(message);
  }
}

interface Collect {
  at: string;
  segment: string;
  units: number;
  price: number;
  return_rate: number;
}

const ajv = new Ajv({ allErrors: false, strict: false });
const validators = new Map<string, ValidateFunction>();
function paramsValidator(use: string): ValidateFunction {
  let v = validators.get(use);
  if (!v) {
    v = ajv.compile(MECHANICS[use].paramsSchema);
    validators.set(use, v);
  }
  return v;
}

export function isModelInput(inp: InputDef): boolean {
  return inp.type === "choice" || inp.type === "number";
}

/** Значение хода: решение команды, иначе default для решений и null для квизов и прогнозов. */
export function inputValue(step: StepDef, inp: InputDef, decisions: Decisions): string | number | null {
  const key = `${step.id}.${inp.id}`;
  const v = key in decisions ? decisions[key] : undefined;
  if (v === undefined || v === null) return isModelInput(inp) ? (inp.default ?? null) : null;
  if (inp.type === "choice" && !inp.options!.some((o) => o.value === v))
    throw new EngineError("E071", `${key}: значения ${JSON.stringify(v)} нет среди вариантов`, step.id);
  if (inp.type === "number" || inp.type === "quiz" || inp.type === "forecast") {
    if (typeof v !== "number") throw new EngineError("E071", `${key}: ожидалось число, получено ${JSON.stringify(v)}`, step.id);
    if ((inp.min !== undefined && v < inp.min) || (inp.max !== undefined && v > inp.max))
      throw new EngineError("E071", `${key}: ${v} вне диапазона [${inp.min ?? "−∞"}, ${inp.max ?? "∞"}]`, step.id);
  }
  return v;
}

export function evalCondition(c: Condition | undefined, step: StepDef | undefined, sc: Scenario, data: unknown): boolean {
  if (c === undefined) return true;
  if (typeof c === "string") {
    const neg = c.startsWith("!");
    const name = neg ? c.slice(1) : c;
    const def = step?.block.conditions?.[name] ?? sc.root.conditions?.[name];
    if (!def) throw new Error(`условие ${name} не объявлено`);
    const r = evalCondition(def, step, sc, data);
    return neg ? !r : r;
  }
  return !!evalLogic(c.expr, data);
}

export function runPath(sc: Scenario, decisions: Decisions): PathResult {
  const ledger = new Ledger();
  const result: PathResult = { decisions, inputs: {}, at: {}, order: [], journal: ledger.journal };
  const states = new Map<string, unknown>();
  const schedule: Collect[] = [];
  const phaseProfit = new Map<string, number>();
  let cumulative = 0;
  const p = sc.root.params;

  sc.steps.forEach((step, stepIndex) => {
    const sid = step.id;
    const input: Record<string, string | number | null> = {};
    for (const inp of step.block.inputs ?? []) input[inp.id] = inputValue(step, inp, decisions);
    result.inputs[sid] = input;

    const firstEntry = ledger.journal.length;
    const metrics: Record<string, unknown> = {};
    const post = (tx: Transaction, pointer?: string) => {
      try {
        ledger.post(sid, tx);
      } catch (e) {
        if (e instanceof LedgerError) throw new EngineError("E061", e.message, sid, pointer);
        throw e;
      }
    };

    // scheduled — возврат долгов, срок которых настал
    const due = schedule.filter((c) => c.at === sid);
    if (due.length) {
      const coll = { returned: 0, written_off: 0, returned_amount: 0, written_off_amount: 0, segments: {} as Record<string, unknown> };
      for (const c of due) {
        const returned = roundHalfUp(c.units * c.return_rate);
        const off = c.units - returned;
        post({
          source: "collections",
          category: "operating",
          legs: [
            { account: "cash", amount: returned * c.price },
            { account: "bad_debt", amount: off * c.price },
            { account: "receivables", amount: -c.units * c.price },
          ],
        });
        coll.returned += returned;
        coll.written_off += off;
        coll.returned_amount += returned * c.price;
        coll.written_off_amount += off * c.price;
        coll.segments[c.segment] = { units: c.units, returned, written_off: off };
      }
      metrics.collections = coll;
    }

    const trade: TradeContext = { queue: [] };
    let demandFixed = false;
    let allocation: (Allocation & { by: string }) | null = null;
    let settled = false;
    const data = (extra: Record<string, unknown> = {}) => ({ p, input, inputs: result.inputs, at: result.at, ...extra });

    const fixDemand = () => {
      if (demandFixed) return;
      demandFixed = true;
      if (trade.queue.length === 0 && trade.traffic !== undefined && trade.conversion !== undefined)
        trade.queue.push({ id: "all", size: roundHalfUp(trade.traffic * trade.conversion), pay: "cash" });
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      if (!allocation) return;
      for (const seg of trade.queue) {
        const n = allocation.units[seg.id] ?? 0;
        if (!n) continue;
        const price = seg.price ?? trade.price;
        if (price === undefined) throw new EngineError("E031", `у сегмента ${seg.id} нет цены`, sid);
        const amount = n * price;
        if (seg.pay === "cash") post({ source: "sales", category: "operating", legs: [{ account: "cash", amount }, { account: "revenue", amount: -amount }] });
        else {
          const at = sc.steps.findIndex((s) => s.id === seg.collect_at);
          if (at <= stepIndex) throw new EngineError("E046", `сегмент ${seg.id}: collect_at ${seg.collect_at} не позже шага продажи`, sid);
          post({ source: "sales", category: "operating", legs: [{ account: "receivables", amount }, { account: "revenue", amount: -amount }] });
          schedule.push({ at: seg.collect_at!, segment: seg.id, units: n, price, return_rate: seg.return_rate! });
        }
      }
    };

    const calls = (step.block.mechanics ?? []).map((call, i) => {
      const m = MECHANICS[call.use];
      if (!m) throw new EngineError("E030", `механика ${call.use} не найдена`, sid, `step:${sid}/mechanics/${i}/use`);
      return { call, i, m, stage: stageOf(m, (call.params ?? {}) as Record<string, unknown>) };
    });
    calls.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.i - b.i);

    for (const { call, i, m, stage } of calls) {
      const pointer = `step:${sid}/mechanics/${i}`;
      const instance = call.id ?? call.use;
      const stageIdx = STAGE_ORDER.indexOf(stage);
      if (stageIdx >= STAGE_ORDER.indexOf("supply")) fixDemand();
      if (stageIdx > STAGE_ORDER.indexOf("supply")) settle();
      const now = stage === "analysis" ? snapshot() : undefined;
      const d = data(now ? { now } : {});
      let params: Record<string, unknown>;
      try {
        if (!evalCondition(call.when, step, sc, d)) continue;
        params = resolveValue((call.params ?? {}) as Json, d) as Record<string, unknown>;
      } catch (e) {
        if (e instanceof RefError) throw new EngineError("E041", e.message, sid, `${pointer}/params`);
        throw e;
      }
      const validate = paramsValidator(call.use);
      if (!validate(params)) {
        const err = validate.errors![0];
        throw new EngineError(
          "E031",
          `${call.use}: params${err.instancePath.replaceAll("/", ".")} ${err.message}; получено ${JSON.stringify(params)}`,
          sid,
          `${pointer}/params${err.instancePath}`,
        );
      }
      let res;
      try {
        res = m.step({ stepId: sid, trade, balances: ledger.balances, now }, params, states.get(instance) as never);
      } catch (e) {
        if (e instanceof EngineError) throw e;
        throw new EngineError("E031", `${call.use}: ${(e as Error).message}`, sid, pointer);
      }
      if (res.trade) {
        if (stage !== "demand") throw new EngineError("E031", `${call.use}: менять спрос можно только на стадии demand`, sid, pointer);
        Object.assign(trade, res.trade);
      }
      if (res.allocation) {
        if (allocation) throw new EngineError("E032", `две механики сбыта в шаге: ${allocation.by} и ${call.use}`, sid, pointer);
        const sold = Object.values(res.allocation.units).reduce((s, x) => s + x, 0);
        if (sold > demandOf(trade)) throw new EngineError("E031", `${call.use}: продано ${sold} больше спроса ${demandOf(trade)}`, sid, pointer);
        allocation = { ...res.allocation, by: call.use };
      }
      if (res.state !== undefined) states.set(instance, res.state);
      for (const tx of res.transactions ?? []) post(tx, pointer);
      if (res.metrics) metrics[instance] = res.metrics;
    }
    fixDemand();
    if (demandOf(trade) > 0 && !allocation) throw new EngineError("E033", "в шаге есть спрос, но нет механики сбыта", sid);
    settle();

    function snapshot(): Snapshot {
      const entries = ledger.journal.slice(firstEntry);
      const lines = pnlLines(entries);
      const day = profit(lines);
      const m: Record<string, unknown> = { ...metrics };
      if (trade.traffic !== undefined || trade.queue.length) {
        const demand = demandOf(trade);
        const traffic = trade.traffic ?? 0;
        m.traffic = traffic;
        m.demand = demand;
        m.price = trade.price;
        m.demand_conversion = traffic ? demand / traffic : 0;
        if (allocation) {
          const sold = Object.values(allocation.units).reduce((s, x) => s + x, 0);
          const byPay = (pay: Segment["pay"]) =>
            trade.queue.filter((s) => s.pay === pay).reduce((s, x) => s + (allocation!.units[x.id] ?? 0), 0);
          Object.assign(m, {
            sold,
            sold_cash: byPay("cash"),
            sold_credit: byPay("credit"),
            produced: allocation.produced,
            waste_units: allocation.waste_units,
            conversion: traffic ? sold / traffic : 0,
            unit_margin: trade.price !== undefined ? trade.price - allocation.unit_cost : undefined,
          });
        }
      }
      const balance = ledger.naturalBalances();
      const cum = cumulative + day;
      return {
        input,
        metrics: m,
        pl: { day, phase: (phaseProfit.get(step.phase) ?? 0) + day, cumulative: cum, lines },
        cf: cashBySource(entries),
        cash: balance.cash ?? 0,
        balance,
        check: { balance: balanceCheck(balance, cum) },
      };
    }

    const snap = snapshot();
    if (snap.check.balance !== 0) throw new EngineError("E061", `баланс не сходится: ${snap.check.balance}`, sid);
    cumulative = snap.pl.cumulative;
    phaseProfit.set(step.phase, snap.pl.phase);
    result.at[sid] = snap;
    result.order.push(sid);
  });
  return result;
}

/** Данные пути для выражений уроков, проверок, панелей: at, inputs, p. */
export function pathData(sc: Scenario, r: PathResult): Record<string, unknown> {
  return { at: r.at, inputs: r.inputs, p: sc.root.params };
}
