// Что видят проектор, пульт и команда (docs/spec.md, п. 3–5;
// docs/scenario-format.md, п. 5.5). Всё считается движком из ходов.
import {
  ACCOUNTS,
  cashFlow,
  evalCondition,
  isModelInput,
  pathDataAt,
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
import { accountLabel, fmt, label, md, mdShared, sourceLabel, withIcon } from "./render";
import { decisionsOf, isClosed, isRevealed, isTakeawaysPanel, panelsOf, phasesOf, showablePhases, stepAt, type Phase, type SessionDoc, type Team } from "./session";

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
  return pathDataAt(doc.scenario, r, i, false);
}
/** После раскрытия: плюс снимок шага; будущих шагов и ходов не видно. */
function afterCtx(doc: SessionDoc, r: PathResult, i: number) {
  const snap = r.at[stepAt(doc, i).id];
  return { ...snap, ...pathDataAt(doc.scenario, r, i, true), input: snap.input };
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
    theme: doc.scenario.root.theme,
  };
}

// ---------- панели результатов ----------

type Mode = { kind: "screen" } | { kind: "team"; team: Team; r: PathResult };

/** Строки P&L: выручка, затем расходы; счета с одинаковой подписью — одной строкой. */
function pnlRows(sc: Scenario, lines: Record<string, number>, phase: string): [string, string][] {
  const sums = new Map<string, number>();
  const ordered = Object.entries(lines).sort(([a], [b]) => (ACCOUNTS[a] === "income" ? 0 : 1) - (ACCOUNTS[b] === "income" ? 0 : 1));
  for (const [a, v] of ordered) {
    if (!v && a !== "revenue") continue;
    const l = accountLabel(sc, a, phase);
    sums.set(l, (sums.get(l) ?? 0) + (ACCOUNTS[a] === "income" ? v : -v));
  }
  return [...sums].map(([l, v]) => [l, fmt(sc, v, "money")]);
}

/** «Продано»: всего, в скобках — сколько из них в долг. */
const soldCell = (sc: Scenario, m: Record<string, number | undefined>) =>
  withIcon(sc, "unit", fmt(sc, m.sold, "int")) + (m.sold_credit ? ` (${m.sold_credit})` : "");

function factsRowsOf(sc: Scenario, s: Snapshot, phase: string): [string, string][] {
  const m = s.metrics as Record<string, number | undefined>;
  const rows: [string, string][] = [];
  if (m.traffic !== undefined) {
    rows.push(["Трафик", withIcon(sc, "people", fmt(sc, m.traffic, "int"))]);
    if (m.demand !== undefined) rows.push(["Хотели купить", withIcon(sc, "people", fmt(sc, m.demand, "int"))]);
    if (m.sold !== undefined) rows.push(["Продано", soldCell(sc, m)]);
    if (m.waste_units) rows.push(["Списано", withIcon(sc, "unit", fmt(sc, m.waste_units, "int"))]);
    if (m.conversion !== undefined) rows.push(["Конверсия", fmt(sc, m.conversion, "percent1")]);
  }
  const lines = s.pl.lines;
  rows.push(...pnlRows(sc, lines, phase));
  if (Object.keys(lines).length) rows.push(["Прибыль шага", fmt(sc, s.pl.day, "money")]);
  // Долги покупателей: пока они есть и в день возврата.
  const debt = s.balance.receivables;
  if (debt !== undefined && (debt !== 0 || s.cf.collections)) rows.push([accountLabel(sc, "receivables", phase), fmt(sc, debt, "money")]);
  for (const [src, v] of Object.entries(s.cf)) if (v && !Object.keys(lines).length) rows.push([sourceLabel(sc, src, phase), fmt(sc, v, "money")]);
  rows.push(["Деньги в кассе", fmt(sc, s.cash, "money")]);
  return rows;
}

/**
 * Показатели по командам. Одна колонка — столбцом «показатель | значение».
 * Несколько команд — строка на команду, показатели в колонках: таблица растёт
 * вниз с числом команд и не уезжает за правый край проектора.
 */
function columnsTable(title: string | undefined, cols: { name: string; rows: [string, string][] }[], center: string[] = []): Block {
  const labels: string[] = [];
  for (const c of cols) for (const [l] of c.rows) if (!labels.includes(l)) labels.push(l);
  const cell = (c: (typeof cols)[number], l: string) => c.rows.find(([x]) => x === l)?.[1] ?? "—";
  if (cols.length === 1) return { type: "table", title, head: ["", cols[0].name], rows: labels.map((l) => [l, cell(cols[0], l)]) };
  const centered = labels.flatMap((l, k) => (center.includes(l) ? [k + 1] : []));
  return { type: "table", title, wide: true, head: ["Команда", ...labels], rows: cols.map((c) => [c.name, ...labels.map((l) => cell(c, l))]), center: centered };
}

function factsBlock(doc: SessionDoc, c: Computed, i: number, mode: Mode): Block {
  const sc = doc.scenario;
  const { id, phase } = stepAt(doc, i);
  const factsRows = (sc: Scenario, s: Snapshot) => factsRowsOf(sc, s, phase);
  if (mode.kind === "team") return { type: "table", title: "Итоги дня", head: ["", mode.team.name], rows: factsRows(sc, mode.r.at[id]) };
  const runs = okRuns(doc, c);
  if (!runs.length) return { type: "table", title: "Итоги дня (эталон)", head: ["", "Эталон"], rows: factsRows(sc, c.ref.at[id]) };
  // Колонка на каждую команду, даже если цифры совпали: зал видит себя на проекторе.
  return columnsTable("Итоги дня", runs.map(({ team, r }) => ({ name: team.name, rows: factsRows(sc, r.at[id]) })), ["Продано"]);
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
        if (inp.type === "forecast" && inp.actual !== undefined) rows.push(["Факт", fmt(sc, safeResolve(inp.actual as Json, afterCtx(doc, mode.r, i))) + unit]);
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
      const actualOf = (r: PathResult) => (inp.actual === undefined ? undefined : safeResolve(inp.actual as Json, afterCtx(doc, r, i)));
      if (inp.type === "forecast") {
        const vals = answered.map(({ team }) => Number(moveOf(doc, team, step, inp)!.value)).sort((a, b) => a - b);
        const note = vals.length
          ? `ответили ${vals.length} из ${doc.teams.length}; разброс ${fmt(sc, vals[0])}–${fmt(sc, vals[vals.length - 1])}${unit}, медиана ${fmt(sc, median(vals))}`
          : "никто не ответил";
        return {
          type: "table",
          title: inp.label,
          head: ["Команда", "Прогноз", ...(inp.actual !== undefined ? ["Факт"] : [])],
          rows: doc.teams.map((t) => {
            const r = c.teams.get(t.id);
            const fact = inp.actual !== undefined && r && !(r instanceof Error) ? [fmt(sc, actualOf(r)) + unit] : inp.actual !== undefined ? ["—"] : [];
            return [t.name, fmt(sc, moveOf(doc, t, step, inp)?.value) + (moveOf(doc, t, step, inp) ? unit : ""), ...fact];
          }),
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
/** Медиана отсортированного списка: при чётном числе — среднее двух средних. */
const median = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
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
    const rows: string[][] = pnlRows(sc, lines, step.phase);
    rows.push(["Прибыль", fmt(sc, profit(lines), "money")]);
    return { type: "table", title: `P&L ${scopeName} · ${who}`, head: ["", ""], rows };
  }
  if (kind === "cashflow") {
    const cf = cashFlow(entries);
    const names = { operating: "Операционная", investing: "Инвестиционная", financing: "Финансовая" } as const;
    const rows: string[][] = [];
    for (const k of ["operating", "investing", "financing"] as const)
      for (const x of cf.sections[k]) rows.push([`${names[k]}: ${sourceLabel(sc, x.source, step.phase)}`, fmt(sc, x.amount, "money")]);
    rows.push(["Изменение денег", fmt(sc, cf.total, "money")]);
    return { type: "table", title: `Cash Flow ${scopeName} · ${who}`, head: ["", ""], rows };
  }
  const snap = r.at[step.id];
  const rows = Object.entries(snap.balance)
    .filter(([a, v]) => v && ["asset", "liability", "equity"].includes(ACCOUNTS[a]))
    .map(([a, v]) => [accountLabel(sc, a, step.phase), fmt(sc, v, "money")]);
  rows.push(["Накопленная прибыль", fmt(sc, snap.pl.cumulative, "money")]);
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
  // Отчёты — свои у каждой команды на телефоне; на проекторе — сравнение команд (панель teams).
  if (p === "statements") return mode.kind === "team" ? (["pnl", "cashflow", "balance"] as const).map((k) => statementBlock(doc, pathFor, i, k, "phase", who)) : [];
  if (p?.variants) return variantsBlocks(doc, c, i, mode, p.variants);
  if (p?.statement) return [statementBlock(doc, pathFor, i, p.statement.kind, p.statement.scope, who)];
  if (p?.metrics) {
    const cols = mode.kind === "team" ? [{ name: mode.team.name, r: mode.r }] : okRuns(doc, c).map(({ team, r }) => ({ name: team.name, r }));
    const src = cols.length ? cols : [{ name: "Эталон", r: c.ref }];
    return [
      columnsTable(
        p.title,
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

/** Ловушки — отдельный экран на проекторе; на телефонах их нет. */
function takeawaysBlocks(doc: SessionDoc, i: number): Block[] {
  const sc = doc.scenario;
  const step = stepAt(doc, i);
  const p = panelsOf(step).find(isTakeawaysPanel) as any;
  const all = p?.takeaways === "all";
  const rows = sc.lessons.filter((l) => l.takeaway && (all || l.phase === step.phase)).map((l) => [l.title, l.text.replace(/\s+/g, " ").trim()]);
  return rows.length ? [{ type: "table", title: all ? "Ловушки игры" : "Ловушки", head: ["Ловушка", "Как избежать"], rows, text: true }] : [];
}

function resultsBlocks(doc: SessionDoc, c: Computed, i: number, mode: Mode): Block[] {
  const step = stepAt(doc, i);
  const ctx = mode.kind === "team" ? afterCtx(doc, mode.r, i) : null;
  const text = slotText(doc, step, "results", ctx);
  const blocks: Block[] = [];
  if (text)
    blocks.push({
      type: "html",
      tone: "results",
      html: mode.kind === "team" ? md(doc.scenario, text, afterCtx(doc, mode.r, i)) : sharedText(doc, c, text, (r) => afterCtx(doc, r, i)),
    });
  for (const panel of panelsOf(step).filter((p) => !isTakeawaysPanel(p))) {
    try {
      blocks.push(...panelBlocks(doc, c, i, panel, mode));
    } catch (e) {
      blocks.push({ type: "error", message: (e as Error).message });
    }
  }
  return blocks;
}

/**
 * Общий текст на проекторе: подстановка, одинаковая у всех команд, выводится
 * числом; разная — «…» (проверка сценария предупреждает об этом, W081).
 */
function sharedText(doc: SessionDoc, c: Computed, text: string, ctxOf: (r: PathResult) => unknown): string {
  const runs = okRuns(doc, c).map((x) => x.r);
  return mdShared(doc.scenario, text, (runs.length ? runs : [c.ref]).map(ctxOf));
}

/** Вводная: текст, под ним картинка. Без команды (проектор) — общий текст. */
function legendBlocks(doc: SessionDoc, i: number, r: PathResult, shared?: Computed): Block[] {
  const step = stepAt(doc, i);
  const blocks: Block[] = [];
  const html = shared ? sharedText(doc, shared, step.legend, (x) => beforeCtx(doc, x, i)) : md(doc.scenario, step.legend, beforeCtx(doc, r, i));
  if (html) blocks.push({ type: "html", tone: "legend", html });
  const img = doc.images[step.id];
  if (img) blocks.push({ type: "image", src: `/api/images/${img}`, layout: step.block.legend?.layout ?? "below" });
  return blocks;
}

/** Задание к ходу; без него — вся вводная. shared — проектор: запасной текст без условий, общие числа. */
function moveBlocks(doc: SessionDoc, i: number, r: PathResult, shared?: Computed): Block[] {
  const step = stepAt(doc, i);
  const move = slotText(doc, step, "move", shared ? null : beforeCtx(doc, r, i));
  if (!move) return legendBlocks(doc, i, r, shared);
  const html = shared ? sharedText(doc, shared, move, (x) => beforeCtx(doc, x, i)) : md(doc.scenario, move, beforeCtx(doc, r, i));
  return [{ type: "html", tone: "move", html }];
}

/** Приём ходов на проекторе: вопросы и кто из команд уже ответил (сами ответы не видны). */
function answeredBlock(doc: SessionDoc, i: number, closed: boolean): Block {
  const step = stepAt(doc, i);
  const inputs = step.block.inputs ?? [];
  const answered = (t: Team, inp: InputDef) => {
    const m = moveOf(doc, t, step, inp);
    return !!m && m.source !== "default";
  };
  return {
    type: "answered",
    questions: inputs.map((x) => x.label),
    teams: doc.teams.map((t) => ({ name: t.name, done: inputs.filter((inp) => answered(t, inp)).length })),
    closed,
  };
}

/** Вопрос залу или вывод. Команда — свой вариант текста и свои числа; проектор — общий текст (sharedText). */
function slotBlocks(doc: SessionDoc, c: Computed, i: number, slot: "discussion" | "debrief", mode: Mode): Block[] {
  const step = stepAt(doc, i);
  const tone = slot === "debrief" ? "debrief" : "discussion";
  if (mode.kind === "team") {
    const text = slotText(doc, step, slot, afterCtx(doc, mode.r, i));
    return text ? [{ type: "html", tone, html: md(doc.scenario, text, afterCtx(doc, mode.r, i)) }] : [];
  }
  const text = slotText(doc, step, slot, null);
  return text ? [{ type: "html", tone, html: sharedText(doc, c, text, (r) => afterCtx(doc, r, i)) }] : [];
}

// ---------- проектор ----------

export function screenView(doc: SessionDoc): ScreenView {
  const c = compute(doc);
  const { step: i, phase } = doc.show;
  const step = stepAt(doc, i);
  let blocks: Block[] = [];
  if (phase === "legend") blocks = legendBlocks(doc, i, c.ref, c);
  else if (phase === "intake" || phase === "closed")
    blocks = [...moveBlocks(doc, i, c.ref, c), answeredBlock(doc, i, phase === "closed" || i < doc.play.step)];
  else if (phase === "results") blocks = resultsBlocks(doc, c, i, { kind: "screen" });
  else if (phase === "question") blocks = slotBlocks(doc, c, i, "discussion", { kind: "screen" });
  else if (phase === "debrief") blocks = slotBlocks(doc, c, i, "debrief", { kind: "screen" });
  else blocks = takeawaysBlocks(doc, i);
  const layout = phase === "legend" && doc.images[step.id] ? (step.block.legend?.layout ?? "below") : "text";
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
  } else if (phase === "results" || phase === "takeaways") blocks = resultsBlocks(doc, c, i, mode);
  else blocks = slotBlocks(doc, c, i, phase === "question" ? "discussion" : "debrief", mode);

  // «Мои дни»: раскрытые шаги с расчётом
  const dayRows: string[][] = [];
  sc.steps.forEach((s, k) => {
    if (!isRevealed(doc, k) || !s.block.mechanics?.length) return;
    const snap = r.at[s.id];
    const m = snap.metrics as Record<string, number | undefined>;
    dayRows.push([s.title, withIcon(sc, "people", fmt(sc, m.traffic, "int")), soldCell(sc, m), fmt(sc, snap.pl.day, "money"), fmt(sc, snap.cash, "money")]);
  });
  const days: Block | null = dayRows.length ? { type: "table", head: ["Шаг", "Трафик", "Продано (в долг)", "Прибыль", "Деньги в кассе"], center: [2], rows: dayRows } : null;

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
    question: "Вопрос залу",
    debrief: "К выводу",
    takeaways: "Ловушки",
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
