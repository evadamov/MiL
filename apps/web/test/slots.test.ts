// Условные тексты move и debrief выбираются по данным команды; проектор — запасной текст.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateScenario } from "@mil/engine";
import { describe, expect, it } from "vitest";
import { addTeam, advance, newSession, submitMove, type SessionDoc } from "../lib/session";
import { screenView, teamView } from "../lib/views";

const NOW = "2026-10-08T10:00:00.000Z";
const CHOICE = "{id: c, type: choice, label: Выбор, options: [{value: a, label: A}, {value: b, label: B}], default: a}";
const MECH = `mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}`;

const MD = `---
id: slots
version: 1
title: Слоты
locale: ru
duration_min: 30
format: 1
library: 1
---

\`\`\`sim
currency: {label: монет}
params: {}
conditions:
  chose_a: {expr: {"==": [{var: inputs.s1.c}, a]}}
reference: ref
\`\`\`

# phase main · Фаза

## step s1 · Первый

Вводная.

\`\`\`sim
duration: {min: 1, max: 1}
inputs:
  - ${CHOICE}
${MECH}
\`\`\`

## step s2 · Второй

Вводная второго.

\`\`\`sim
duration: {min: 1, max: 1}
inputs:
  - ${CHOICE.replace("id: c", "id: d")}
${MECH}
\`\`\`

### move (if chose_a)

Вчера вы выбрали A.

### move

Вчера вы выбрали не A.

### debrief (if chose_a)

Разбор для тех, кто выбрал A.

### debrief

Общий разбор.

# checks

## check ref · Эталон

\`\`\`sim
expect: {at.s2.check.balance: 0}
\`\`\`
`;

function session(): SessionDoc {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mil-slots-"));
  const dir = path.join(root, "scenarios", "slots");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "scenario.md"), MD);
  const rep = validateScenario(dir, root);
  expect(rep.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const doc = newSession("SLOTS", "k", rep.scenario!, {}, NOW);
  addTeam(doc, "Альфа", "ta", "t1", NOW);
  addTeam(doc, "Бета", "tb", "t2", NOW);
  return doc;
}
const step = (doc: SessionDoc, phase: string) => {
  while (doc.play.phase !== phase || doc.play.step !== 1) (advance(doc, NOW), doc.version++);
};
const htmlOf = (blocks: { type: string; html?: string; tone?: string }[], tone: string) =>
  blocks.filter((b) => b.type === "html" && b.tone === tone).map((b) => b.html).join("");

describe("условные слоты на экранах", () => {
  it("move: каждая команда видит свой вариант по своему прошлому ходу; проектор — запасной", () => {
    const doc = session();
    advance(doc, NOW); // s1: вводная → приём
    submitMove(doc, "ta", "s1", { c: "a" }, NOW);
    submitMove(doc, "tb", "s1", { c: "b" }, NOW);
    step(doc, "intake");
    expect(htmlOf(teamView(doc, doc.teams[0]).blocks, "move")).toContain("Вчера вы выбрали A.");
    expect(htmlOf(teamView(doc, doc.teams[1]).blocks, "move")).toContain("Вчера вы выбрали не A.");
    expect(htmlOf(screenView(doc).blocks, "move")).toContain("Вчера вы выбрали не A.");
  });

  it("debrief: так же по данным команды", () => {
    const doc = session();
    advance(doc, NOW);
    submitMove(doc, "ta", "s1", { c: "a" }, NOW);
    submitMove(doc, "tb", "s1", { c: "b" }, NOW);
    step(doc, "debrief");
    expect(htmlOf(teamView(doc, doc.teams[0]).blocks, "debrief")).toContain("Разбор для тех, кто выбрал A.");
    expect(htmlOf(teamView(doc, doc.teams[1]).blocks, "debrief")).toContain("Общий разбор.");
    expect(htmlOf(screenView(doc).blocks, "debrief")).toContain("Общий разбор.");
  });
});
