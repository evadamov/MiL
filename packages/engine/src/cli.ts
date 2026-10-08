#!/usr/bin/env -S npx tsx
// sim validate [каталог сценария ...]   — проверка, как при сборке приложения
// sim play <каталог> [шаг.поле=значение ...] — прогон одной команды по шагам
// sim export-json <каталог>                 — сценарий в виде scenario.json
import fs from "node:fs";
import path from "node:path";
import { compileScenario } from "./compiler/compile.ts";
import { toJson } from "./compiler/json.ts";
import { EngineError, runPath } from "./engine.ts";
import { formatDiagnostic } from "./cli-format.ts";
import type { Decisions } from "./types.ts";
import { validateScenario } from "./validate.ts";

const start = process.env.INIT_CWD ?? process.cwd();

function repoRoot(from: string): string {
  let dir = path.resolve(from);
  while (!fs.existsSync(path.join(dir, "scenarios"))) {
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
  return dir;
}

function scenarioDirs(root: string, args: string[]): string[] {
  if (args.length) return args.map((a) => path.resolve(start, a));
  const base = path.join(root, "scenarios");
  return fs
    .readdirSync(base)
    .map((d) => path.join(base, d))
    .filter((d) => fs.existsSync(path.join(d, "scenario.md")) || fs.existsSync(path.join(d, "scenario.json")));
}


function validate(args: string[]): number {
  const root = repoRoot(start);
  let errors = 0;
  for (const dir of scenarioDirs(root, args)) {
    const rep = validateScenario(dir, root);
    const name = path.relative(root, dir).replaceAll("\\", "/");
    const errs = rep.diagnostics.filter((d) => d.severity === "error");
    const warns = rep.diagnostics.filter((d) => d.severity === "warning");
    const infos = rep.diagnostics.filter((d) => d.severity === "info");
    errors += errs.length;
    console.log(`\n${errs.length ? "✗" : "✓"} ${name}`);
    if (rep.scenario) {
      const t = rep.time;
      console.log(`  шагов ${rep.scenario.steps.length}, путей ${rep.paths}${rep.sampled ? " (выборка)" : ""}${t ? `, время ${t.min}–${t.max} из ${t.budget} мин` : ""}`);
      for (const l of rep.lessons) if (l.kind !== "unverified") console.log(`  вывод ${l.id}: ${l.passed}/${l.total}`);
      if (infos.length) console.log(`  выводов без механической проверки: ${infos.length}`);
      for (const c of rep.checks) console.log(`  проверка ${c.id}: ${c.passed}/${c.total}`);
    }
    for (const d of [...errs, ...warns]) console.log("\n" + formatDiagnostic(d));
  }
  console.log(errors ? `\nошибок: ${errors}` : "\nошибок нет");
  return errors ? 1 : 0;
}

function play(args: string[]): number {
  const [dirArg, ...sets] = args;
  if (!dirArg) {
    console.error("sim play <каталог сценария> [шаг.поле=значение ...]");
    return 2;
  }
  const root = repoRoot(start);
  const { scenario, diagnostics } = compileScenario(path.resolve(start, dirArg), root);
  if (!scenario || diagnostics.some((d) => d.severity === "error")) {
    diagnostics.forEach((d) => console.log(formatDiagnostic(d)));
    return 1;
  }
  const decisions: Decisions = {};
  for (const s of sets) {
    const [k, v] = s.split("=");
    decisions[k] = v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  try {
    const r = runPath(scenario, decisions);
    const pad = (x: unknown, n: number) => String(x ?? "").padStart(n);
    console.log(`${"шаг".padEnd(12)}${pad("трафик", 8)}${pad("продано", 9)}${pad("прибыль", 9)}${pad("фаза", 7)}${pad("итого", 7)}${pad("деньги", 8)}  ходы`);
    for (const id of r.order) {
      const s = r.at[id];
      const m = s.metrics as Record<string, unknown>;
      const moves = Object.entries(s.input).map(([k, v]) => `${k}=${v ?? "—"}`).join(" ");
      console.log(`${id.padEnd(12)}${pad(m.traffic, 8)}${pad(m.sold, 9)}${pad(s.pl.day, 9)}${pad(s.pl.phase, 7)}${pad(s.pl.cumulative, 7)}${pad(s.cash, 8)}  ${moves}`);
    }
    const last = r.at[r.order.at(-1)!];
    console.log(`\nбаланс: ${Object.entries(last.balance).map(([k, v]) => `${k} ${v}`).join(", ")}; проверка ${last.check.balance}`);
    return 0;
  } catch (e) {
    if (e instanceof EngineError) {
      console.log(`${e.code}  step ${e.step}\n  ${e.message}`);
      return 1;
    }
    throw e;
  }
}

function exportJson(args: string[]): number {
  const [dirArg] = args;
  if (!dirArg) {
    console.error("sim export-json <каталог сценария>  — печатает scenario.json");
    return 2;
  }
  const { scenario, diagnostics } = compileScenario(path.resolve(start, dirArg), repoRoot(start));
  if (!scenario || diagnostics.some((d) => d.severity === "error")) {
    diagnostics.forEach((d) => console.error(formatDiagnostic(d)));
    return 1;
  }
  process.stdout.write(JSON.stringify(toJson(scenario), null, 2) + "\n");
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (a: string[]) => number> = { validate, play, "export-json": exportJson };
const code = commands[cmd]?.(rest) ?? (console.log(`команды: ${Object.keys(commands).join(", ")}`), 2);
process.exitCode = code;
