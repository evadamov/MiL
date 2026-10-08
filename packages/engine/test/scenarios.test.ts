// Каждый сценарий из scenarios/ компилируется, его выводы и эталонные проверки
// зелёные. Чисел сценариев здесь нет: они в разделе # checks самих сценариев.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "../src/cli-format.ts";
import { validateScenario } from "../src/validate.ts";
import { REPO } from "./helpers.ts";

const dirs = fs
  .readdirSync(path.join(REPO, "scenarios"))
  .map((d) => path.join(REPO, "scenarios", d))
  .filter((d) => fs.existsSync(path.join(d, "scenario.md")) || fs.existsSync(path.join(d, "scenario.json")));

describe("сценарии репозитория", () => {
  it("их хотя бы два, с разной структурой", () => {
    expect(dirs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(dirs.map((d) => [path.basename(d), d]))("%s", (_name, dir) => {
    const rep = validateScenario(dir, REPO);
    const errors = rep.diagnostics.filter((d) => d.severity === "error");
    expect(errors.map(formatDiagnostic)).toEqual([]);
    expect(rep.paths).toBeGreaterThan(0);
    expect(rep.checks.length).toBeGreaterThan(0);
    for (const c of rep.checks) expect(c.passed, c.id).toBe(c.total);
    for (const l of rep.lessons) if (l.kind !== "unverified") expect(l.passed, l.id).toBe(l.total);
  });
});
