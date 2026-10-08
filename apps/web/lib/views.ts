// Что видят проектор, пульт и команда (docs/spec.md, п. 3–5;
// docs/scenario-format.md, п. 5.5). Всё считается движком из ходов.
import {
  ACCOUNTS,
  cashFlow,
  evalCondition,
  isModelInput,
  pathData,
  pnlLines,
  profit,
  resolveValue,
  runPath,
  variantRows,
  type InputDef,
  type Json,
  type PathResult,
  type Scenario,
  type Snapshot,
  type StepDef,
} from "@mil/engine";
import { PHASE_LABELS, type Block, type ControlView, type Field, type Header, type ScreenView, type TeamView } from "./blocks";
import { accountLabel, fmt, label, md, sourceLabel } from "./render";
import { decisionsOf, isClosed, isRevealed, phasesOf, showablePhases, stepAt, type Phase, type SessionDoc, type Team } from "./session";

// ---------- расчёт путей, кэш по версии документа ----------

interface Computed {
  ref: PathResult;
  teams: Map<string, PathResult | Error>;
}
const cache = new Map<string, { version: number; computed: Computed }>();

function referenceDecisions(sc: Scenario) {
  return sc.checks.find((c) => c.id === sc.root.reference)?.decisions ?? {};
}

export function compute(doc: SessionDoc): Computed {
  const hit = cache.get(doc.code);
  if (hit && hit.version === doc.version) return hit.computed;
  const sc = doc.scenario;
  const teams = new Map<string, PathResult | Error>();
  for (const t of doc.teams) {
    try {
      teams.set(t.id, runPath(sc, decisionsOf(doc, t.id)));
    } catch (e) {
      teams.set(t.id, e as Error);
    }
  }
  const computed = { ref: runPath(sc, referenceDecisions(sc)), teams };
  cache.set(doc.code, { version: doc.version, computed });
  return computed;
}

const okRuns = (doc: SessionDoc, c: Computed) =>
  doc.teams.flatMap((t) => {
    const r = c.teams.get(t.id);
    return r && !(r instanceof Error) ? [{ team: t, r }] : [];
  });

// ---------- контексты подстановок ----------

/** До хода: параметры, прошлые раскрытые шаги, ходы. */
function beforeCtx(doc: SessionDoc, r: PathResult, i: number) {
  const at = Object.fromEntries(doc.scenario.steps.slice(0, i).map((s) => [s.id, r.at[s.id]]));
  return { p: doc.scenario.root.params, at, inputs: r.inputs };
}
/** После раскрытия: плюс снимок шага. */
function afterCtx(doc: SessionDoc, r: PathResult, i: number) {
  const snap = r.at[stepAt(doc, i).id];
  return { ...snap, ...pathData(doc.scenario, r), input: snap.input };
}

function slotText(doc: SessionDoc, step: StepDef, name: string, ctx: unknown | null): string | null {
  const cands = step.slots.filter((s) => s.name === name);
  if (!cands.length) return null;
  if (ctx)
    for (const s of cands)
      if (s.cond)
        try {
          if (evalCondition(s.cond, step, doc.scenario, ctx)) return s.text;
        } catch {
          /* условие не вычислилось — берём запасной вариант */
        }
  return cands.find((s) => !s.cond)?.text ?? null;
}

// ---------- заголовок ----------

function header(doc: SessionDoc, i: number, phase: Phase): Header {
  const step = stepAt(doc, i);
  return {
    scenario: doc.scenario.meta.title,
    phaseTitle: doc.scenario.phases.find((p) => p.id === step.phase)?.title ?? "",
    stepTitle: step.title,
    stepNo: i + 1,
    steps: doc.scenario.steps.length,
    stage: PHASE_LABELS[phase],
  };
}

// ---------- панели результатов ----------

type Mode = { kind: "screen" } | { kind: "team"; team: Team; r: PathResult };

function factsRows(sc: Scenario, s: Snapshot): [string, string][] {
  const m = s.metrics as Record<string, number | undefined>;
  const rows: [string, string][] = [];
  if (m.traffic !== undefined) {
    rows.push(["Трафик", fmt(sc, m.traffic, "int")]);
    if (m.demand !== undefined) rows.push(["Хотели купить", fmt(sc, m.demand, "int")]);
    if (m.sold !== undefined) rows.push(["Продано", fmt(sc, m.sold, "int") + (m.sold_credit ? ` (в долг ${m.sold_credit})` : "")]);
    if (m.waste_units) rows.push(["Списано, ед.", fmt(sc, m.waste_units, "int")]);
    if (m.conversion !== undefined) rows.push(["Конверсия", fmt(sc, m.conversion, "percent1")]);
  }
  const lines = s.pl.lines;
  if ("revenue" in lines) rows.push([accountLabel(sc, "revenue"), fmt(sc, lines.revenue, "money")]);
  for (const [a, v] of Object.entries(lines)) if (a !== "revenue" && v) rows.push([accountLabel(sc, a), fmt(sc, -v, "money")]);
  if (Object.keys(lines).length) rows.push(["Прибыль шага", fmt(sc, s.pl.day, "money")]);
  for (const [src, v] of Object.entries(s.cf)) if (v && !Object.keys(lines).length) rows.push([sourceLabel(sc, src), fmt(sc, v, "money")]);
  rows.push(["Деньги на конец", fmt(sc, s.cash, "money")]);
  return rows;
}

function columnsTable(title: string | undefined, cols: { name: string; rows: [string, string][] }[]): Block {
  const labels: string[] = [];
  for (const c of cols) for (const [l] of c.rows) if (!labels.includes(l)) labels.push(l);
  return {
    type: "table",
    title,
    head: ["", ...cols.map((c) => c.name)],
    rows: labels.map((l) => [l, ...cols.map((c) => c.rows.find(([x]) => x === l)?.[1] ?? "—")]),
  };
}

function factsBlock(doc: SessionDoc, c: Computed, i: number, mode: Mode): Block {
  const sc = doc.scenario;
  const id = stepAt(doc, i).id;
  if (mode.kind === "team") return { type: "table", title: "Итоги дня", head: ["", mode.team.name], rows: factsRows(sc, mode.r.at[id]) };
  const runs = okRuns(doc, c);
  if (!runs.length) return { type: "table", title: "Итоги дня (эталон)", head: ["", "Эталон"], rows: factsRows(sc, c.ref.at[id]) };
  const cols = runs.map(({ team, r }) => ({ name: team.name, rows: factsRows(sc, r.at[id]) }));
  const same = cols.every((x) => JSON.stringify(x.rows) === JSON.stringify(cols[0].rows));
  return columnsTable("Итоги дня", same ? [{ name: "Все команды", rows: cols[0].rows }] : cols);
}

function moveOf(doc: SessionDoc, team: Team, step: StepDef, inp: InputDef) {
  return doc.moves[team.id]?.[step.id]?.[inp.id];
}

function choicesBlocks(doc: SessionDoc, i: number, mode: Mode): Block[] {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  const inputs = (step.block.inputs ?? []).filter(isModelInput);
  return inputs.map((inp) => {
    const mark = (src?: string) => (src === "default" ? " · по умолчанию" : src === "trainer" ? " · ведущий" : "");
    if (mode.kind === "team") {
      const m = moveOf(doc, mode.team, step, inp);
      return { type: "table", title: inp.label, head: ["Ваш ход"], rows: [[label(sc, m?.value, inp.options) + mark(m?.source)]] } as Block;
    }
    if (inp.type === "choice")
      return {
        type: "table",
        title: inp.label,
        head: ["Вариант", "Команд", "Кто"],
        rows: inp.options!.map((o) => {
          const who = doc.teams.filter((t) => String(moveOf(doc, t, step, inp)?.value) === String(o.value));
          return [o.label, String(who.length), who.map((t) => t.name + mark(moveOf(doc, t, step, inp)?.source)).join(", ")];
        }),
      } as Block;
    return {
      type: "table",
      title: inp.label,
      head: ["Команда", "Ход"],
      rows: doc.teams.map((t) => {
        const m = moveOf(doc, t, step, inp);
        return [t.name, fmt(sc, m?.value) + mark(m?.source)];
      }),
    } as Block;
  });
}

function answersBlocks(doc: SessionDoc, c: Computed, i: number, mode: Mode): Block[] {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  const answerFor = (inp: InputDef, r: PathResult): number | null => {
    try {
      const a = resolveValue(inp.answer as Json, afterCtx(doc, r, i));
      return typeof a === "number" ? a : null;
    } catch {
      return null;
    }
  };
  const correct = (inp: InputDef, v: unknown, a: number | null) =>
    a === null || v === undefined ? null : Math.abs(Number(v) - a) <= (inp.tolerance ?? 0) + 1e-9;
  return (step.block.inputs ?? [])
    .filter((x) => !isModelInput(x))
    .map((inp) => {
      const unit = inp.unit ? ` ${inp.unit}` : "";
      if (mode.kind === "team") {
        const v = moveOf(doc, mode.team, step, inp)?.value;
        const rows: string[][] = [["Ваш ответ", v === undefined ? "вы не ответили" : fmt(sc, v) + unit]];
        if (inp.type === "quiz") {
          const a = answerFor(inp, mode.r);
          rows.push(["Правильный ответ", a === null ? "—" : fmt(sc, roundShown(a)) + unit + (inp.tolerance ? ` (±${fmt(sc, inp.tolerance)})` : "")]);
          const ok = correct(inp, v, a);
          if (ok !== null) rows.push(["", ok ? "верно" : "неверно"]);
        }
        return { type: "table", title: inp.label, head: ["", ""], rows, note: inp.type === "quiz" && inp.explain ? fillExplain(doc, inp, mode.r, i) : undefined } as Block;
      }
      const runs = okRuns(doc, c);
      const answered = runs.filter(({ team }) => moveOf(doc, team, step, inp) !== undefined);
      if (inp.type === "forecast") {
        const vals = answered.map(({ team }) => Number(moveOf(doc, team, step, inp)!.value)).sort((a, b) => a - b);
        const note = vals.length
          ? `ответили ${vals.length} из ${doc.teams.length}; разброс ${fmt(sc, vals[0])}–${fmt(sc, vals[vals.length - 1])}${unit}, медиана ${fmt(sc, vals[Math.floor((vals.length - 1) / 2)])}`
          : "никто не ответил";
        return {
          type: "table",
          title: inp.label,
          head: ["Команда", "Прогноз"],
          rows: doc.teams.map((t) => [t.name, fmt(sc, moveOf(doc, t, step, inp)?.value) + (moveOf(doc, t, step, inp) ? unit : "")]),
          note,
        } as Block;
      }
      let right = 0;
      const rows = runs.map(({ team, r }) => {
        const v = moveOf(doc, team, step, inp)?.value;
        const a = answerFor(inp, r);
        const ok = correct(inp, v, a);
        if (ok) right++;
        return [team.name, v === undefined ? "—" : fmt(sc, v) + unit, a === null ? "—" : fmt(sc, roundShown(a)) + unit, ok === null ? "—" : ok ? "верно" : "неверно"];
      });
      return {
        type: "table",
        title: inp.label,
        head: ["Команда", "Ответ", "Правильный", ""],
        rows,
        note: `верно ${right} из ${answered.length} ответивших` + (inp.explain ? `. ${fillExplain(doc, inp, c.ref, i)}` : ""),
      } as Block;
    });
}

const roundShown = (x: number) => Math.round(x * 100) / 100;
function fillExplain(doc: SessionDoc, inp: InputDef, r: PathResult, i: number): string {
  return md(doc.scenario, inp.explain ?? "", afterCtx(doc, r, i)).replace(/<\/?p>/g, "").trim();
}

function variantsBlocks(doc: SessionDoc, c: Computed, i: number, mode: Mode, only?: string): Block[] {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  return (step.block.variants ?? [])
    .filter((v) => !only || v.id === only)
    .map((vr) => {
      const [sid, iid] = vr.input.split(".");
      const dstep = sc.steps.find((s) => s.id === sid)!;
      const inp = dstep.block.inputs!.find((x) => x.id === iid)!;
      const rows = variantRows(sc, c.ref.decisions, vr);
      const chosen = (t: Team) => doc.moves[t.id]?.[sid]?.[iid]?.value;
      const own = mode.kind === "team" ? chosen(mode.team) : undefined;
      const extra = mode.kind === "team" && own !== undefined && !rows.some((r) => String(r.value) === String(own))
        ? variantRows(sc, c.ref.decisions, { ...vr, values: [own] })
        : [];
      const all = [...rows, ...extra];
      const body = all.map((r) => {
        const cells = r.cells.map((x, k) => fmt(sc, x, vr.columns[k].format));
        const who = mode.kind === "screen" ? [doc.teams.filter((t) => String(chosen(t)) === String(r.value)).map((t) => t.name).join(", ")] : [];
        return [label(sc, r.value, inp.options), ...cells, ...who];
      });
      return {
        type: "table",
        title: `Что было бы при другом выборе: ${inp.label}`,
        head: [inp.unit ? `Выбор, ${inp.unit}` : "Выбор", ...vr.columns.map((x) => x.label), ...(mode.kind === "screen" ? ["Команды"] : [])],
        rows: body,
        highlight: mode.kind === "team" ? all.flatMap((r, k) => (String(r.value) === String(own) ? [k] : [])) : undefined,
        note: "Расчёт на эталонных решениях остальных дней — меняется только этот выбор.",
      } as Block;
    });
}

function statementBlock(doc: SessionDoc, r: PathResult, i: number, kind: "pnl" | "cashflow" | "balance", scope: "step" | "phase" | "game", who: string): Block {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  const ids = sc.steps
    .slice(0, i + 1)
    .filter((s, k) => scope === "game" || (scope === "phase" ? s.phase === step.phase : k === i))
    .map((s) => s.id);
  const entries = r.journal.filter((e) => ids.includes(e.step));
  const scopeName = scope === "game" ? "за игру" : scope === "phase" ? `за фазу «${sc.phases.find((p) => p.id === step.phase)?.title ?? ""}»` : "за шаг";
  if (kind === "pnl") {
    const lines = pnlLines(entries);
    const ordered = Object.entries(lines).sort(([a], [b]) => (ACCOUNTS[a] === "income" ? 0 : 1) - (ACCOUNTS[b] === "income" ? 0 : 1));
    const rows = ordered.map(([a, v]) => [accountLabel(sc, a), fmt(sc, ACCOUNTS[a] === "income" ? v : -v, "money")]);
    rows.push(["Прибыль", fmt(sc, profit(lines), "money")]);
    return { type: "table", title: `P&L ${scopeName} · ${who}`, head: ["", ""], rows };
  }
  if (kind === "cashflow") {
    const cf = cashFlow(entries);
    const names = { operating: "Операционная", investing: "Инвестиционная", financing: "Финансовая" } as const;
    const rows: string[][] = [];
    for (const k of ["operating", "investing", "financing"] as const)
      for (const x of cf.sections[k]) rows.push([`${names[k]}: ${sourceLabel(sc, x.source)}`, fmt(sc, x.amount, "money")]);
    rows.push(["Изменение денег", fmt(sc, cf.total, "money")]);
    return { type: "table", title: `Cash Flow ${scopeName} · ${who}`, head: ["", ""], rows };
  }
  const snap = r.at[step.id];
  const rows = Object.entries(snap.balance)
    .filter(([a, v]) => v && ["asset", "liability", "equity"].includes(ACCOUNTS[a]))
    .map(([a, v]) => [accountLabel(sc, a), fmt(sc, v, "money")]);
  rows.push(["Накопленная прибыль", fmt(sc, snap.pl.cumulative, "money")]);
  rows.push(["Проверка баланса", fmt(sc, snap.check.balance)]);
  return { type: "table", title: `Баланс на конец · ${who}`, head: ["", ""], rows };
}

function valueLabel(doc: SessionDoc, ref: Json, v: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith("$inputs.")) return null;
  const [, sid, iid] = ref.slice(1).split(".");
  const inp = doc.scenario.steps.find((s) => s.id === sid)?.block.inputs?.find((x) => x.id === iid);
  return inp?.options ? label(doc.scenario, v, inp.options) : null;
}

function panelBlocks(doc: SessionDoc, c: Computed, i: number, panel: Json, mode: Mode): Block[] {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  const p = panel as any;
  const pathFor = mode.kind === "team" ? mode.r : c.ref;
  const who = mode.kind === "team" ? mode.team.name : "эталонная команда";
  if (p === "facts") return [factsBlock(doc, c, i, mode)];
  if (p === "choices") return choicesBlocks(doc, i, mode);
  if (p === "answers") return answersBlocks(doc, c, i, mode);
  if (p === "variants") return variantsBlocks(doc, c, i, mode);
  if (p === "statements") return (["pnl", "cashflow", "balance"] as const).map((k) => statementBlock(doc, pathFor, i, k, "phase", who));
  if (p === "takeaways" || p?.takeaways) {
    const all = p?.takeaways === "all";
    const rows = sc.lessons.filter((l) => l.takeaway && (all || l.phase === step.phase)).map((l) => [l.title, l.text.replace(/\s+/g, " ").trim()]);
    return rows.length ? [{ type: "table", title: all ? "Выводы игры" : "Выводы", head: ["Ловушка", "Как избежать"], rows }] : [];
  }
  if (p?.variants) return variantsBlocks(doc, c, i, mode, p.variants);
  if (p?.statement) return [statementBlock(doc, pathFor, i, p.statement.kind, p.statement.scope, who)];
  if (p?.metrics) {
    const cols = mode.kind === "team" ? [{ name: mode.team.name, r: mode.r }] : okRuns(doc, c).map(({ team, r }) => ({ name: team.name, r }));
    const src = cols.length ? cols : [{ name: "Эталон", r: c.ref }];
    return [
      columnsTable(
        undefined,
        src.map(({ name, r }) => ({
          name,
          rows: p.metrics.map((m: any) => [m.label, fmt(sc, safeResolve(m.value, afterCtx(doc, r, i)), m.format)] as [string, string]),
        })),
      ),
    ];
  }
  if (p?.table) {
    const t = step.block.tables?.[p.table] as any;
    const rows = safeResolve(t.rows, afterCtx(doc, pathFor, i));
    if (!Array.isArray(rows)) return [{ type: "error", message: `таблица ${p.table}: нет строк` }];
    return [
      {
        type: "table",
        head: t.columns.map((x: any) => x.label),
        rows: rows.map((row: any) =>
          t.columns.map((col: any) => fmt(sc, typeof col.value === "string" && !col.value.startsWith("$") ? row[col.value] : safeResolve(col.value, afterCtx(doc, pathFor, i)), col.format)),
        ),
      },
    ];
  }
  if (p?.teams) {
    const runs = okRuns(doc, c).filter(({ team }) => mode.kind === "screen" || team.id === mode.team.id);
    return [
      {
        type: "table",
        title: "Команды",
        head: ["Команда", ...p.teams.columns.map((x: any) => x.label)],
        rows: runs.map(({ team, r }) => [
          team.name,
          ...p.teams.columns.map((col: any) => {
            const v = safeResolve(col.value, afterCtx(doc, r, i));
            return valueLabel(doc, col.value, v) ?? fmt(sc, v, col.format);
          }),
        ]),
      },
    ];
  }
  return [{ type: "error", message: `неизвестная панель ${JSON.stringify(panel)}` }];
}

function safeResolve(v: Json, ctx: unknown): unknown {
  try {
    return resolveValue(v, ctx);
  } catch {
    return undefined;
  }
}

function defaultPanels(step: StepDef): Json[] {
  if (step.block.results?.panels) return step.block.results.panels;
  if (step.block.type === "summary") return ["statements", "takeaways"];
  const inputs = step.block.inputs ?? [];
  const p: Json[] = [];
  if (inputs.some(isModelInput)) p.push("choices");
  if (inputs.some((x) => !isModelInput(x))) p.push("answers");
  if (step.block.variants?.length) p.push("variants");
  if (step.block.mechanics?.length) p.push("facts");
  return p;
}

function resultsBlocks(doc: SessionDoc, c: Computed, i: number, mode: Mode): Block[] {
  const step = stepAt(doc, i);
  const ctx = mode.kind === "team" ? afterCtx(doc, mode.r, i) : null;
  const text = slotText(doc, step, "results", ctx);
  const blocks: Block[] = [];
  if (text) blocks.push({ type: "html", tone: "results", html: md(doc.scenario, text, afterCtx(doc, mode.kind === "team" ? mode.r : c.ref, i)) });
  for (const panel of defaultPanels(step)) {
    try {
      blocks.push(...panelBlocks(doc, c, i, panel, mode));
    } catch (e) {
      blocks.push({ type: "error", message: (e as Error).message });
    }
  }
  return blocks;
}

function legendBlocks(doc: SessionDoc, i: number, r: PathResult): Block[] {
  const step = stepAt(doc, i);
  const blocks: Block[] = [];
  const img = doc.images[step.id];
  if (img) blocks.push({ type: "image", src: `/api/images/${img}`, layout: step.block.legend?.layout ?? "side" });
  const html = md(doc.scenario, step.legend, beforeCtx(doc, r, i));
  if (html) blocks.push({ type: "html", tone: "legend", html });
  return blocks;
}

function moveBlocks(doc: SessionDoc, i: number, r: PathResult): Block[] {
  const step = stepAt(doc, i);
  const move = slotText(doc, step, "move", null);
  return move ? [{ type: "html", tone: "move", html: md(doc.scenario, move, beforeCtx(doc, r, i)) }] : legendBlocks(doc, i, r);
}

function debriefBlocks(doc: SessionDoc, i: number, r: PathResult, withDiscussion: boolean): Block[] {
  const step = stepAt(doc, i);
  const out: Block[] = [];
  const d = slotText(doc, step, "debrief", null);
  if (d) out.push({ type: "html", tone: "debrief", html: md(doc.scenario, d, afterCtx(doc, r, i)) });
  const q = withDiscussion ? slotText(doc, step, "discussion", null) : null;
  if (q) out.push({ type: "html", tone: "discussion", html: md(doc.scenario, q, afterCtx(doc, r, i)) });
  return out;
}

function submittedCount(doc: SessionDoc, i: number): number {
  const id = stepAt(doc, i).id;
  return doc.teams.filter((t) => Object.values(doc.moves[t.id]?.[id] ?? {}).some((m) => m.source === "team")).length;
}

// ---------- проектор ----------

export function screenView(doc: SessionDoc): ScreenView {
  const c = compute(doc);
  const { step: i, phase } = doc.show;
  const step = stepAt(doc, i);
  let blocks: Block[] = [];
  if (phase === "legend") blocks = legendBlocks(doc, i, c.ref);
  else if (phase === "intake" || phase === "closed")
    blocks = [...moveBlocks(doc, i, c.ref), { type: "counter", submitted: submittedCount(doc, i), total: doc.teams.length, closed: phase === "closed" || i < doc.play.step }];
  else if (phase === "results") blocks = resultsBlocks(doc, c, i, { kind: "screen" });
  else blocks = debriefBlocks(doc, i, c.ref, true);
  const layout = phase === "legend" && doc.images[step.id] ? (step.block.legend?.layout ?? "side") : "text";
  return { version: doc.version, header: header(doc, i, phase), layout, blocks, finished: doc.finished };
}

// ---------- команда ----------

function fieldOf(doc: SessionDoc, team: Team, step: StepDef, inp: InputDef): Field {
  const m = moveOf(doc, team, step, inp);
  return {
    id: inp.id,
    type: inp.type,
    label: inp.label,
    unit: inp.unit,
    min: inp.min,
    max: inp.max,
    step: inp.step,
    options: inp.options?.map((o) => ({ value: String(o.value), label: o.label })),
    value: m ? String(m.value) : undefined,
    source: m?.source,
  };
}

export function teamView(doc: SessionDoc, team: Team): TeamView {
  const c = compute(doc);
  const sc = doc.scenario;
  const r = c.teams.get(team.id);
  const { step: i, phase } = doc.play;
  const step = stepAt(doc, i);
  const base = { version: doc.version, team: { id: team.id, name: team.name }, header: header(doc, i, phase), finished: doc.finished };
  if (!r || r instanceof Error) return { ...base, blocks: [{ type: "error", message: `не удалось посчитать: ${(r as Error)?.message}` }], days: null, reports: [], info: [] };
  const mode: Mode = { kind: "team", team, r };
  let blocks: Block[];
  if (phase === "legend") blocks = legendBlocks(doc, i, r);
  else if (phase === "intake" || phase === "closed") {
    const fields = (step.block.inputs ?? []).map((inp) => fieldOf(doc, team, step, inp));
    blocks = [...moveBlocks(doc, i, r), { type: "form", stepId: step.id, open: phase === "intake", fields }];
  } else if (phase === "results") blocks = resultsBlocks(doc, c, i, mode);
  else blocks = debriefBlocks(doc, i, r, false);

  // «Мои дни»: раскрытые шаги с расчётом
  const dayRows: string[][] = [];
  sc.steps.forEach((s, k) => {
    if (!isRevealed(doc, k) || !s.block.mechanics?.length) return;
    const snap = r.at[s.id];
    const m = snap.metrics as Record<string, number | undefined>;
    dayRows.push([s.title, fmt(sc, m.traffic, "int"), fmt(sc, m.sold, "int"), fmt(sc, snap.pl.day, "money"), fmt(sc, snap.cash, "money")]);
  });
  const days: Block | null = dayRows.length ? { type: "table", head: ["Шаг", "Трафик", "Продано", "Прибыль", "Деньги"], rows: dayRows } : null;

  // «Отчёты»: после раскрытых шагов «Итоги»
  const reports: Block[] = [];
  sc.steps.forEach((s, k) => {
    if (s.block.type !== "summary" || !isRevealed(doc, k)) return;
    const scope = k === sc.steps.length - 1 ? "game" : "phase";
    for (const kind of ["pnl", "cashflow", "balance"] as const) reports.push(statementBlock(doc, r, k, kind, scope, team.name));
  });

  const info = sc.pages
    .filter((pg) => {
      const from = pg.from ? sc.steps.findIndex((s) => s.id === pg.from) : 0;
      return from <= i;
    })
    .map((pg) => ({ id: pg.id, title: pg.title, html: md(sc, pg.text, { p: sc.root.params }) }));
  return { ...base, blocks, days, reports, info };
}

// ---------- пульт ----------

export function controlView(doc: SessionDoc): ControlView {
  const sc = doc.scenario;
  const { step: i, phase } = doc.play;
  const step = stepAt(doc, i);
  const phases = phasesOf(step);
  const k = phases.indexOf(phase);
  const nextLabel: Record<string, string> = {
    intake: "Открыть приём ходов",
    closed: "Закрыть приём",
    results: "Показать результаты",
    debrief: "К выводу",
  };
  const next = doc.finished
    ? null
    : k < phases.length - 1
      ? nextLabel[phases[k + 1]]
      : i < sc.steps.length - 1
        ? `Следующий шаг: ${sc.steps[i + 1].title}`
        : "Завершить воркшоп";
  const inputs = step.block.inputs ?? [];
  const teams = doc.teams.map((t) => ({
    id: t.id,
    name: t.name,
    submitted: Object.values(doc.moves[t.id]?.[step.id] ?? {}).some((m) => m.source === "team"),
    values: inputs.map((inp) => {
      const m = moveOf(doc, t, step, inp);
      return {
        inputId: inp.id,
        label: inp.label,
        value: m ? label(sc, m.value, inp.options) : isModelInput(inp) ? "—" : "нет ответа",
        raw: m ? String(m.value) : undefined,
        source: m?.source ?? "",
      };
    }),
  }));
  const notes: Block[] = [];
  const phaseNotes = sc.phases.find((p) => p.id === step.phase)?.slots.find((s) => s.name === "trainer");
  const stepNotes = step.slots.find((s) => s.name === "trainer");
  const tr = step.block.trainer;
  const flags = [tr?.checkpoint ? `Контрольное время: ${tr.checkpoint}` : "", tr?.protected ? "Этот шаг нельзя резать" : ""].filter(Boolean).join(" · ");
  if (flags) notes.push({ type: "html", tone: "note", html: `<p><strong>${flags}</strong></p>` });
  if (stepNotes) notes.push({ type: "html", tone: "trainer", html: md(sc, stepNotes.text, { p: sc.root.params }) });
  if (phaseNotes) notes.push({ type: "html", tone: "trainer", html: md(sc, phaseNotes.text, { p: sc.root.params }) });
  return {
    version: doc.version,
    code: doc.code,
    header: header(doc, i, phase),
    play: { step: i, phase },
    show: { ...doc.show },
    showingCurrent: doc.show.step === i && doc.show.phase === phase,
    finished: doc.finished,
    next,
    canReopen: phase === "closed",
    canOverride: phase === "intake" || phase === "closed",
    steps: sc.steps.slice(0, i + 1).map((s, idx) => ({
      index: idx,
      id: s.id,
      title: s.title,
      phases: showablePhases(doc, idx).map((ph) => ({ phase: ph, label: PHASE_LABELS[ph] })),
    })),
    teams,
    inputs: inputs.map((inp) => ({
      id: inp.id,
      type: inp.type,
      label: inp.label,
      unit: inp.unit,
      min: inp.min,
      max: inp.max,
      step: inp.step,
      options: inp.options?.map((o) => ({ value: String(o.value), label: o.label })),
    })),
    notes,
    preview: screenView(doc),
  };
}

export { isClosed };
