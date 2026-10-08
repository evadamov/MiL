// Граница движок/сценарий (docs/engine.md, п. 1): в исходниках платформы нет
// идентификаторов сценариев — шагов, фаз, полей хода, параметров, выводов, проверок.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenario } from "../src/compiler/compile.ts";
import { ACCOUNTS } from "../src/ledger.ts";
import { ALLOWED_OPERATIONS } from "../src/logic.ts";
import { MECHANICS } from "../src/mechanics/index.ts";
import { REPO } from "./helpers.ts";

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "test" || e.name.startsWith(".") ? [] : sources(p);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

function paramKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      paramKeys(x, out);
    }
  else if (Array.isArray(v)) v.forEach((x) => paramKeys(x, out));
  return out;
}

describe("движок не знает сценариев", () => {
  const ids = new Set<string>();
  for (const d of fs.readdirSync(path.join(REPO, "scenarios"))) {
    const sc = compileScenario(path.join(REPO, "scenarios", d), REPO).scenario;
    if (!sc) continue;
    ids.add(sc.meta.id);
    for (const x of [...sc.phases, ...sc.steps, ...sc.lessons, ...sc.checks, ...sc.pages]) ids.add(x.id);
    for (const s of sc.steps)
      for (const i of s.block.inputs ?? []) {
        ids.add(i.id);
        for (const o of i.options ?? []) if (typeof o.value === "string") ids.add(o.value);
      }
    for (const k of paramKeys(sc.root.params)) ids.add(k);
  }
  // Словарь платформы — счета, механики, их параметры, операции выражений — не знание сценария,
  // даже если сценарий назвал свой параметр так же (например, park.loan).
  const generic = new Set([
    ...Object.keys(ACCOUNTS),
    ...Object.keys(MECHANICS),
    ...ALLOWED_OPERATIONS,
    ...Object.values(MECHANICS).flatMap((m) => [...paramKeys(m.paramsSchema)]),
  ]);
  const needles = [...ids].filter((x) => !generic.has(x) && x.length > 2);

  it("идентификаторов для поиска достаточно", () => {
    expect(needles.length).toBeGreaterThan(20);
  });

  it("в packages/*/src и apps/*/src нет строк с идентификаторами сценариев", () => {
    const files = [...sources(path.join(REPO, "packages")), ...sources(path.join(REPO, "apps"))];
    expect(files.length).toBeGreaterThan(5);
    const hits: string[] = [];
    for (const f of files) {
      // Комментарии не в счёт: в них можно сослаться на пример из сценария.
      const code = fs
        .readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      for (const id of needles) if (new RegExp(`\\b${id}\\b`).test(code)) hits.push(`${path.relative(REPO, f)}: ${id}`);
    }
    expect(hits).toEqual([]);
  });
});
