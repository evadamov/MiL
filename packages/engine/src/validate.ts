// Проверка сценария: схемы и ссылки, перебор путей, инварианты учёта,
// бюджет времени, выводы, эталонные проверки (docs/engine.md, п. 6).
import fs from "node:fs";
import path from "node:path";
import { compileScenario } from "./compiler/compile.ts";
import { EngineError, evalCondition, isModelInput, pathData, runPath, type PathResult } from "./engine.ts";
import { collectRefs, evalLogic, getPath, isExpr, isRef, resolveValue } from "./logic.ts";
import { MECHANICS, stageOf } from "./mechanics/index.ts";
import type { Condition, Decisions, Diagnostic, Json, Pos, Scenario, StepDef } from "./types.ts";
import { variantRows } from "./variants.ts";

export interface LessonReport {
  id: string;
  kind: string;
  passed: number;
  total: number;
}
export interface CheckReport {
  id: string;
  passed: number;
  total: number;
}
export interface ValidationReport {
  scenario?: Scenario;
  diagnostics: Diagnostic[];
  paths: number;
  sampled: boolean;
  time?: { min: number; max: number; budget: number };
  lessons: LessonReport[];
  checks: CheckReport[];
}

const MAX_PATHS = 20000;
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
const SNAPSHOT_KEYS = new Set(["input", "metrics", "pl", "cf", "cash", "balance", "check"]);
const FORMATS = new Set(["int", "money", "percent", "percent1", "text"]);

type Ctx = "mechanic" | "analysis" | "after" | "legend";

export function validateScenario(dir: string, root = process.cwd()): ValidationReport {
  const { scenario: sc, diagnostics } = compileScenario(dir, root);
  const report: ValidationReport = { scenario: sc, diagnostics, paths: 0, sampled: false, lessons: [], checks: [] };
  if (!sc || diagnostics.some((d) => d.severity === "error")) return report;
  const diag = (d: Omit<Diagnostic, "severity"> & { severity?: Diagnostic["severity"] }) =>
    diagnostics.push({ severity: d.code.startsWith("W") ? "warning" : d.code.startsWith("I") ? "info" : "error", ...d });
  const at = (pointer: string, fallback?: Pos): Pos | undefined => {
    let p = pointer;
    while (p && !(p in sc.sourcemap)) p = p.slice(0, Math.max(p.lastIndexOf("/"), 0));
    return sc.sourcemap[p] ?? fallback;
  };
  const stepIndex = new Map(sc.steps.map((s, i) => [s.id, i]));
  const findInput = (key: string) => {
    const [sid, iid] = key.split(".");
    const step = sc.steps.find((s) => s.id === sid);
    return { step, inp: step?.block.inputs?.find((i) => i.id === iid) };
  };

  // ---------- статические проверки ----------
  const checkRef = (ref: string, step: StepDef | undefined, ctx: Ctx, pointer: string) => {
    const [ns, ...rest] = ref.split(".");
    const pos = at(pointer, step?.pos);
    const bad = (code: string, message: string) => diag({ code, message, pos, where: step ? `step ${step.id}` : undefined });
    const cur = step ? stepIndex.get(step.id)! : sc.steps.length;
    if (ns === "p") {
      if (getPath(sc.root.params, rest.join(".")) === undefined) bad("E040", `нет параметра ${ref}`);
    } else if (ns === "input") {
      const inp = step?.block.inputs?.find((i) => i.id === rest[0]);
      if (!inp) bad("E040", `в шаге нет поля ${rest[0]}`);
      else if (ctx === "mechanic" && !isModelInput(inp)) bad("E044", `механика ссылается на ${inp.type} ${inp.id}: он не меняет модель`);
    } else if (ns === "inputs") {
      const { step: s, inp } = findInput(`${rest[0]}.${rest[1]}`);
      if (!s) bad("E040", `нет шага ${rest[0]}`);
      else if (stepIndex.get(s.id)! > cur) bad("E041", `ссылка на будущий шаг ${s.id}`);
      else if (!inp) bad("E040", `в шаге ${s.id} нет поля ${rest[1]}`);
      else if (ctx === "mechanic" && !isModelInput(inp)) bad("E044", `механика ссылается на ${inp.type} ${s.id}.${inp.id}`);
    } else if (ns === "at") {
      const s = sc.steps.find((x) => x.id === rest[0]);
      if (!s) bad("E040", `нет шага ${rest[0]}`);
      else {
        const idx = stepIndex.get(s.id)!;
        const limit = ctx === "after" ? cur : cur - 1;
        if (idx > limit) bad("E041", idx === cur ? `шаг ${s.id} ещё не посчитан в этот момент` : `ссылка на будущий шаг ${s.id}`);
        if (rest[1] && !SNAPSHOT_KEYS.has(rest[1])) bad("E040", `у снимка шага нет поля ${rest[1]}`);
      }
    } else if (ns === "now") {
      if (ctx !== "analysis") bad("E040", "$now доступен только механикам стадии analysis");
    } else if (ns === "metrics") {
      if (ctx !== "after") bad("E040", "$metrics доступен только в панелях и тексте результатов");
    } else bad("E040", `неизвестное пространство имён «${ns}» в ${ref}`);
  };
  const checkValue = (v: unknown, step: StepDef | undefined, ctx: Ctx, pointer: string) => {
    for (const r of collectRefs(v)) checkRef(r, step, ctx, pointer);
  };
  const checkCond = (c: Condition | undefined, step: StepDef | undefined, ctx: Ctx, pointer: string) => {
    if (c === undefined) return;
    if (typeof c === "string") {
      const name = c.replace(/^!/, "");
      if (!step?.block.conditions?.[name] && !sc.root.conditions?.[name])
        diag({ code: "E040", message: `условие ${name} не объявлено`, pos: at(pointer, step?.pos), where: step ? `step ${step.id}` : undefined });
    } else checkValue(c, step, ctx, pointer);
  };

  if (!sc.checks.find((c) => c.id === sc.root.reference))
    diag({ code: "E040", message: `reference: нет проверки ${sc.root.reference}`, pos: at("root/reference") });
  else if (sc.checks.find((c) => c.id === sc.root.reference)!.sweep)
    diag({ code: "E040", message: "reference должен указывать на проверку без sweep", pos: at("root/reference") });

  const literalSeen = new Map<number, { step: string; pointer: string }>();
  for (const step of sc.steps) {
    const b = step.block;
    const ptr = `step:${step.id}`;
    if (b.duration.min > b.duration.max) diag({ code: "E021", message: "duration.min больше max", pos: at(`${ptr}/duration`) });
    const ids = new Set<string>();
    (b.inputs ?? []).forEach((inp, i) => {
      const ip = `${ptr}/inputs/${i}`;
      if (ids.has(inp.id)) diag({ code: "E012", message: `повтор поля ${inp.id}`, pos: at(ip) });
      ids.add(inp.id);
      if (isModelInput(inp)) {
        if (inp.default === undefined) diag({ code: "E043", message: `у ${inp.type} ${inp.id} нет default`, pos: at(ip), where: `step ${step.id}` });
        if (inp.type === "number" && !inp.samples) diag({ code: "E043", message: `у number ${inp.id} нет samples`, pos: at(ip), where: `step ${step.id}` });
        if (inp.type === "choice" && inp.default !== undefined && !inp.options!.some((o) => o.value === inp.default))
          diag({ code: "E043", message: `default ${inp.default} не среди вариантов`, pos: at(`${ip}/default`) });
        const vals = inp.type === "number" ? [...(inp.samples ?? []), ...(inp.default !== undefined ? [Number(inp.default)] : [])] : [];
        for (const x of vals)
          if ((inp.min !== undefined && x < inp.min) || (inp.max !== undefined && x > inp.max))
            diag({ code: "E043", message: `значение ${x} вне [${inp.min}, ${inp.max}]`, pos: at(ip) });
      }
      if (inp.type === "quiz") checkValue(inp.answer, step, "after", `${ip}/answer`);
    });
    (b.mechanics ?? []).forEach((call, i) => {
      const mp = `${ptr}/mechanics/${i}`;
      const m = MECHANICS[call.use];
      if (!m) {
        diag({ code: "E030", message: `механика ${call.use} не найдена; есть: ${Object.keys(MECHANICS).join(", ")}`, pos: at(`${mp}/use`), where: `step ${step.id}` });
        return;
      }
      if (call.use === "inventory" && typeof call.params?.mode !== "string")
        diag({ code: "E031", message: "inventory.mode должен быть литералом", pos: at(`${mp}/params/mode`) });
      const ctx: Ctx = stageOf(m, (call.params ?? {}) as Record<string, unknown>) === "analysis" ? "analysis" : "mechanic";
      checkValue(call.params, step, ctx, `${mp}/params`);
      checkCond(call.when, step, ctx, `${mp}/when`);
      const walk = (v: unknown, p: string) => {
        if (isRef(v) || isExpr(v)) return;
        if (typeof v === "number" && v !== 0 && v !== 1) {
          const first = literalSeen.get(v);
          if (first && first.step !== step.id)
            diag({ code: "W030", message: `число ${v} литералом и в шаге ${first.step}; вынесите в params`, pos: at(p) });
          else if (!first) literalSeen.set(v, { step: step.id, pointer: p });
        } else if (Array.isArray(v)) v.forEach((x, k) => walk(x, `${p}/${k}`));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`);
      };
      walk(call.params, `${mp}/params`);
    });
    for (const [name, c] of Object.entries(b.conditions ?? {})) checkCond(c, step, "after", `${ptr}/conditions/${name}`);
    (b.variants ?? []).forEach((vr, i) => {
      const vp = `${ptr}/variants/${i}`;
      const { step: s, inp } = findInput(vr.input);
      if (!s || !inp) diag({ code: "E040", message: `variants.input ${vr.input} не найден`, pos: at(`${vp}/input`) });
      else if (stepIndex.get(s.id)! > stepIndex.get(step.id)!) diag({ code: "E045", message: `таблица вариантов раньше решения ${vr.input}`, pos: at(`${vp}/input`) });
      else if (!isModelInput(inp)) diag({ code: "E044", message: `варианты по ${inp.type} ${vr.input} не имеют смысла`, pos: at(`${vp}/input`) });
      checkValue(vr.columns, step, "after", `${vp}/columns`);
    });
    checkValue(b.results, step, "after", `${ptr}/results`);
    checkValue(b.tables, step, "after", `${ptr}/tables`);
    for (const p of b.results?.panels ?? []) {
      if (p && typeof p === "object" && "table" in p && !b.tables?.[(p as { table: string }).table])
        diag({ code: "E040", message: `таблицы ${(p as { table: string }).table} нет в tables`, pos: at(`${ptr}/results`) });
      if ((p === "variants" || (p && typeof p === "object" && "variants" in p)) && !b.variants?.length)
        diag({ code: "E040", message: "панель variants без variants в шаге", pos: at(`${ptr}/results`) });
    }
    for (const s of step.slots) if (s.cond) checkCond(s.cond, step, "after", ptr);
    if (b.legend?.image) {
      const img = b.legend.image;
      const file = path.join(sc.dir, img);
      const ip = at(`${ptr}/legend/image`);
      if (/^[a-z]+:/i.test(img)) diag({ code: "E014", message: "внешние ссылки на картинки запрещены", pos: ip });
      else if (!IMAGE_EXT.includes(path.extname(img).toLowerCase())) diag({ code: "E014", message: `формат ${path.extname(img)} не поддерживается: ${IMAGE_EXT.join(", ")}`, pos: ip });
      else if (!fs.existsSync(file)) diag({ code: "E014", message: `нет файла ${img}`, pos: ip });
      else if (fs.statSync(file).size > 2 * 1024 * 1024) diag({ code: "E014", message: `${img} больше 2 МБ`, pos: ip });
    }
  }
  for (const pg of sc.pages)
    if (pg.from && !stepIndex.has(pg.from)) diag({ code: "E040", message: `page ${pg.id}: нет шага ${pg.from}`, pos: at(`page:${pg.id}/from`, pg.pos) });

  const modelKey = (key: string, where: string, pos?: Pos) => {
    const { inp } = findInput(key);
    if (!inp) diag({ code: "E040", message: `${where}: нет поля ${key}`, pos });
    else if (!isModelInput(inp)) diag({ code: "E044", message: `${where}: ${key} не меняет модель`, pos });
    return inp;
  };
  for (const l of sc.lessons) {
    if (l.phase && !sc.phases.some((p) => p.id === l.phase)) diag({ code: "E040", message: `lesson ${l.id}: нет фазы ${l.phase}`, pos: l.pos });
    if (l.contrast) modelKey(l.contrast.input, `lesson ${l.id}`, at(`lesson:${l.id}/contrast/input`, l.pos));
    if (l.sweep) modelKey(l.sweep.input, `lesson ${l.id}`, at(`lesson:${l.id}/sweep/input`, l.pos));
  }
  for (const c of sc.checks) {
    for (const k of Object.keys(c.decisions ?? {})) modelKey(k, `check ${c.id}`, at(`check:${c.id}/decisions/${k}`, c.pos));
    if (c.sweep) {
      modelKey(c.sweep.input, `check ${c.id}`, at(`check:${c.id}/sweep/input`, c.pos));
      if (c.sweep.base && !sc.checks.some((x) => x.id === c.sweep!.base)) diag({ code: "E040", message: `check ${c.id}: нет base ${c.sweep.base}`, pos: c.pos });
    }
  }

  // бюджет времени
  const tmin = sc.steps.reduce((s, x) => s + x.block.duration.min, 0);
  const tmax = sc.steps.reduce((s, x) => s + x.block.duration.max, 0);
  report.time = { min: tmin, max: tmax, budget: sc.meta.duration_min };
  if (tmax > sc.meta.duration_min) diag({ code: "E060", message: `сумма duration.max ${tmax} мин больше duration_min ${sc.meta.duration_min}`, pos: sc.steps[0].pos });

  if (diagnostics.some((d) => d.severity === "error")) return report;

  // ---------- перебор путей ----------
  const spaces: [string, (string | number)[]][] = [];
  for (const s of sc.steps)
    for (const inp of s.block.inputs ?? [])
      if (isModelInput(inp)) spaces.push([`${s.id}.${inp.id}`, inp.type === "choice" ? inp.options!.map((o) => o.value) : inp.samples!]);
  const total = spaces.reduce((n, [, vs]) => n * vs.length, 1);
  let combos: Decisions[];
  if (total <= MAX_PATHS) combos = spaces.reduce<Decisions[]>((acc, [k, vs]) => acc.flatMap((a) => vs.map((x) => ({ ...a, [k]: x }))), [{}]);
  else {
    // Сэмплирование: каждое значение каждого хода хотя бы раз, остальные — по умолчанию.
    report.sampled = true;
    combos = [{}];
    for (const [k, vs] of spaces) for (const x of vs) combos.push({ [k]: x });
  }
  const cache = new Map<string, PathResult>();
  const keyOf = (d: Decisions) => JSON.stringify(Object.entries(d).filter(([, x]) => x !== undefined && x !== null).sort());
  const failed = new Set<string>();
  const run = (d: Decisions): PathResult | undefined => {
    const k = keyOf(d);
    if (cache.has(k)) return cache.get(k);
    try {
      const r = runPath(sc, d);
      cache.set(k, r);
      return r;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      const sig = `${e.code}:${e.step}:${e.pointer}`;
      if (!failed.has(sig)) {
        failed.add(sig);
        diag({ code: e.code, message: e.message, where: `step ${e.step}`, pos: e.pointer ? at(e.pointer) : sc.steps.find((s) => s.id === e.step)?.pos, details: [`ходы: ${fmtDecisions(d)}`] });
      }
      return undefined;
    }
  };
  const runs = combos.map((d) => ({ d, r: run(d) })).filter((x): x is { d: Decisions; r: PathResult } => !!x.r);
  report.paths = runs.length;
  if (diagnostics.some((d) => d.severity === "error")) return report;

  // ---------- эталонный путь: таблицы вариантов, панели, ответы, подстановки ----------
  const checkById = new Map(sc.checks.map((c) => [c.id, c]));
  const decisionsOf = (id: string, seen = new Set<string>()): Decisions => {
    const c = checkById.get(id);
    if (!c || seen.has(id)) return {};
    seen.add(id);
    return { ...(c.sweep?.base ? decisionsOf(c.sweep.base, seen) : {}), ...(c.decisions ?? {}) };
  };
  const ref = run(decisionsOf(sc.root.reference));
  if (ref) {
    const refData = pathData(sc, ref);
    for (const step of sc.steps) {
      const ptr = `step:${step.id}`;
      const snap = ref.at[step.id];
      const after = { ...snap, ...refData, input: snap.input };
      const tryResolve = (v: unknown, pointer: string) => {
        try {
          resolveValue(v as Json, after);
        } catch (e) {
          diag({ code: "E040", message: (e as Error).message, pos: at(pointer, step.pos), where: `step ${step.id}` });
        }
      };
      for (const vr of step.block.variants ?? [])
        try {
          variantRows(sc, ref.decisions, vr, (d) => run(d) ?? runPath(sc, d));
        } catch (e) {
          diag({ code: e instanceof EngineError ? e.code : "E040", message: (e as Error).message, pos: at(`${ptr}/variants`, step.pos) });
        }
      tryResolve(step.block.results, `${ptr}/results`);
      for (const [name, t] of Object.entries(step.block.tables ?? {})) {
        const rows = resolveValue((t as { rows: Json }).rows, after);
        if (!Array.isArray(rows)) diag({ code: "E040", message: `tables.${name}.rows — не список`, pos: at(`${ptr}/tables/${name}/rows`) });
      }
      (step.block.inputs ?? []).forEach((inp, i) => {
        if (inp.type !== "quiz") return;
        try {
          const a = resolveValue(inp.answer as Json, after);
          if (typeof a !== "number") diag({ code: "E031", message: `ответ квиза ${inp.id} — не число: ${JSON.stringify(a)}`, pos: at(`${ptr}/inputs/${i}/answer`) });
        } catch (e) {
          diag({ code: "E040", message: (e as Error).message, pos: at(`${ptr}/inputs/${i}/answer`) });
        }
      });
      // подстановки: вводная и move — до хода, остальное — после
      const before = { p: sc.root.params, at: Object.fromEntries(Object.entries(ref.at).filter(([k]) => stepIndex.get(k)! < stepIndex.get(step.id)!)), inputs: ref.inputs };
      const texts: { text: string; ctx: unknown; pos: Pos }[] = [
        { text: step.legend, ctx: before, pos: step.pos },
        ...step.slots.map((s) => ({ text: s.text, ctx: s.name === "move" ? before : after, pos: s.pos })),
        ...(step.block.inputs ?? []).map((inp, i) => ({ text: `${inp.label} ${inp.explain ?? ""}`, ctx: after, pos: at(`${ptr}/inputs/${i}`, step.pos)! })),
      ];
      for (const t of texts) checkTemplates(t.text, { ...(t.ctx as object), p: sc.root.params }, t.pos, `step ${step.id}`, diag);
      // условия слотов вычисляются
      for (const s of step.slots)
        if (s.cond)
          try {
            evalCondition(s.cond, step, sc, after);
          } catch (e) {
            diag({ code: "E040", message: (e as Error).message, pos: s.pos });
          }
    }
    for (const pg of sc.pages) checkTemplates(pg.text, { p: sc.root.params }, pg.pos, `page ${pg.id}`, diag);
  }

  // ---------- выводы ----------
  const p = sc.root.params;
  const byKey = new Map(runs.map((x) => [keyOf(x.d), x]));
  const without = (d: Decisions, k: string) => keyOf(Object.fromEntries(Object.entries(d).filter(([x]) => x !== k)));
  for (const l of sc.lessons) {
    const rep: LessonReport = { id: l.id, kind: l.kind, passed: 0, total: 0 };
    report.lessons.push(rep);
    const pos = at(`lesson:${l.id}/assert`, l.pos);
    // Переменные условия вывода и их значения на упавшем пути — для отчёта.
    const vars = [...new Set(collectRefs({ expr: l.assert ?? null }))].filter((v) => !v.startsWith("rows"));
    const values = (data: unknown) => vars.map((v) => `${v} = ${JSON.stringify(getPath(data, v))}`).join(", ");
    const fail = (details: string[], data?: unknown) => {
      if (rep.total - rep.passed === 1)
        diag({ code: "E070", message: `вывод ${l.id} не выполнен`, pos, where: `lesson ${l.id}`, details: data && vars.length ? [...details, values(data)] : details });
    };
    if (l.kind === "unverified") {
      diag({ code: "I071", severity: "info", message: `вывод «${l.title}» без механической проверки`, pos: l.pos, where: `lesson ${l.id}` });
      continue;
    }
    if (l.kind === "path")
      for (const x of runs) {
        rep.total++;
        const data = pathData(sc, x.r);
        if (evalLogic(l.assert!, data)) rep.passed++;
        else fail([`ходы: ${fmtDecisions(x.d)}`], data);
      }
    if (l.kind === "contrast" && l.contrast) {
      const { input, b, quantifier = "all", where } = l.contrast;
      const as = Array.isArray(l.contrast.a) ? l.contrast.a : [l.contrast.a];
      for (const bx of runs.filter((x) => x.d[input] === b)) {
        const results: boolean[] = [];
        let failedPair: unknown;
        for (const av of as) {
          const ax = byKey.get(keyOf({ ...bx.d, [input]: av }));
          if (!ax) continue;
          const pair = { a: pathData(sc, ax.r), b: pathData(sc, bx.r), p };
          if (where && !evalCondition(where, undefined, sc, pair)) continue;
          const ok = !!evalLogic(l.assert!, pair);
          if (!ok) failedPair ??= pair;
          results.push(ok);
        }
        if (!results.length) continue;
        rep.total++;
        if (quantifier === "all" ? results.every(Boolean) : results.some(Boolean)) rep.passed++;
        else fail([`пара: ${input} = ${JSON.stringify(as)} против ${JSON.stringify(b)}`, `прочие ходы: ${fmtDecisions(bx.d, input)}`], failedPair);
      }
    }
    if (l.kind === "sweep" && l.sweep) {
      const k = l.sweep.input;
      const groups = new Map<string, { value: unknown }[]>();
      for (const x of runs) {
        const g = without(x.d, k);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push({ value: x.d[k], ...pathData(sc, x.r) });
      }
      for (const [g, rows] of groups) {
        rep.total++;
        if (evalLogic(l.assert!, { rows, p })) rep.passed++;
        else fail([`прочие ходы: ${g}`]);
      }
    }
    if (rep.total === 0) diag({ code: "W070", message: `вывод ${l.id}: ни одной подходящей пары путей`, pos: l.pos });
  }

  // ---------- проверки ----------
  for (const c of sc.checks) {
    const rep: CheckReport = { id: c.id, passed: 0, total: 0 };
    report.checks.push(rep);
    const base = decisionsOf(c.id);
    const compare = (d: Decisions, expect: Record<string, Json>, tag: string) => {
      const r = run(d);
      if (!r) return;
      const data = { ...pathData(sc, r), path: { steps: r.order.length } };
      for (const [key, exp] of Object.entries(expect)) {
        rep.total++;
        const got = getPath(data, key);
        const ok = exp && typeof exp === "object" && !Array.isArray(exp) && "approx" in exp
          ? typeof got === "number" && Math.abs(got - Number(exp.approx)) <= Number(exp.tolerance ?? 0)
          : JSON.stringify(got) === JSON.stringify(exp);
        if (ok) rep.passed++;
        else
          diag({
            code: "E071",
            message: `${key}: ожидалось ${JSON.stringify(exp)}, получено ${JSON.stringify(got)}`,
            pos: at(`check:${c.id}/${tag}`, c.pos),
            where: `check ${c.id}`,
            details: [`ходы: ${fmtDecisions(d)}`],
          });
      }
    };
    if (c.expect) compare(base, c.expect, `expect`);
    if (c.sweep) c.sweep.rows.forEach((row, i) => compare({ ...base, [c.sweep!.input]: row.value }, row.expect, `sweep/rows/${i}`));
  }
  return report;
}

function fmtDecisions(d: Decisions, omit?: string): string {
  const e = Object.entries(d).filter(([k, v]) => k !== omit && v !== null && v !== undefined);
  return e.length ? e.map(([k, v]) => `${k}=${v}`).join(", ") : "все по умолчанию";
}

function checkTemplates(text: string, ctx: unknown, pos: Pos, where: string, diag: (d: Omit<Diagnostic, "severity">) => void) {
  for (const m of text.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}\s]+)\s*)?\}\}/g)) {
    const [, p, fmt] = m;
    if (fmt && !FORMATS.has(fmt)) diag({ code: "E080", message: `неизвестный формат «${fmt}» в {{${p} | ${fmt}}}`, pos, where });
    if (getPath(ctx, p) === undefined) diag({ code: "E080", message: `{{${p}}}: нет такой переменной в этот момент шага`, pos, where });
  }
}
