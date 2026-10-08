import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileScenario } from "../src/compiler/compile.ts";
import type { Scenario } from "../src/types.ts";

/** Временный каталог сценария с файлами; id каталога = id сценария. */
export function writeScenario(id: string, files: Record<string, string>): { root: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mil-test-"));
  const dir = path.join(root, "scenarios", id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return { root, dir };
}

export function compileOk(id: string, files: Record<string, string>): Scenario {
  const { root, dir } = writeScenario(id, files);
  const r = compileScenario(dir, root);
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  if (errors.length || !r.scenario) throw new Error(errors.map((e) => `${e.code} ${e.pos?.line}: ${e.message}`).join("\n"));
  return r.scenario;
}

/** Минимальный сценарий с одним шагом; блок шага и текст подставляются. */
export function oneStep(block: string, extraRoot = "", extra = ""): string {
  return `---
id: t
version: 1
title: Тест
locale: ru
duration_min: 60
format: 1
library: 1
---

\`\`\`sim
currency: {label: монет}
params: {price: 10, cost: 4}
reference: ref
${extraRoot}
\`\`\`

# phase main · Фаза

## step s1 · Шаг

Вводная.

\`\`\`sim
${block}
\`\`\`
${extra}
# checks

## check ref · Эталон

\`\`\`sim
expect: {at.s1.check.balance: 0}
\`\`\`
`;
}

export const REPO = path.resolve(import.meta.dirname, "../../..");
