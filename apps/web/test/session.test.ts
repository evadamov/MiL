import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileScenario, type Scenario } from "@mil/engine";
import { describe, expect, it } from "vitest";
import {
  addTeam,
  advance,
  isRevealed,
  newSession,
  override,
  phasesOf,
  reopen,
  SessionError,
  show,
  showablePhases,
  stepAt,
  submitMove,
  type SessionDoc,
} from "../lib/session";
import { FileStore } from "../lib/store";
import { controlView, screenView, teamView } from "../lib/views";

const REPO = path.resolve(import.meta.dirname, "../../..");
const load = (id: string): Scenario => compileScenario(path.join(REPO, "scenarios", id), REPO).scenario!;
const NOW = "2026-10-08T10:00:00.000Z";

function session(id: string, teams = ["Альфа", "Бета", "Гамма"]): SessionDoc {
  const doc = newSession("TEST1", "trainer", load(id), {}, NOW);
  teams.forEach((n, i) => addTeam(doc, n, `t${i}`, `tok${i}`, NOW));
  return doc;
}
const bump = (doc: SessionDoc) => (doc.version++, doc);
/** Двигает игру до фазы шага с заданным id. */
function goto(doc: SessionDoc, stepId: string, phase: string) {
  while (!(stepAt(doc, doc.play.step).id === stepId && doc.play.phase === phase)) bump((advance(doc, NOW), doc));
}

describe("фазы шага", () => {
  it("тип шага определяет фазы", () => {
    const sc = load("lemonade");
    const by = (id: string) => phasesOf(sc.steps.find((s) => s.id === id)!);
    expect(by("intro")).toEqual(["legend"]);
    expect(by("d1")).toEqual(["legend", "results"]);
    expect(by("d2")).toEqual(["legend", "intake", "closed", "results"]);
    expect(by("d3")).toEqual(["legend", "intake", "closed", "results", "debrief"]);
    expect(by("d6")).toEqual(["legend", "results", "debrief"]);
  });
});

describe("приём ходов", () => {
  it("ход принимается только на шаге игры в фазе приёма; повтор перезаписывает", () => {
    const doc = session("rink_tea");
    expect(() => submitMove(doc, "t0", "fri", { thermoses: 2 }, NOW)).toThrow(SessionError);
    goto(doc, "fri", "intake");
    submitMove(doc, "t0", "fri", { thermoses: 2 }, NOW);
    submitMove(doc, "t0", "fri", { thermoses: 3 }, NOW);
    expect(doc.moves.t0.fri.thermoses).toMatchObject({ value: 3, source: "team" });
    expect(() => submitMove(doc, "t0", "fri", { thermoses: 99 }, NOW)).toThrow(/не больше/);
    expect(() => submitMove(doc, "t0", "sat", { thermoses: 2 }, NOW)).toThrow(/закрыт/);
  });

  it("закрытие: решения без хода получают default, квиз и прогноз остаются без ответа", () => {
    const doc = session("lemonade");
    goto(doc, "d3", "intake");
    submitMove(doc, "t0", "d3", { collected_forecast: 30 }, NOW);
    advance(doc, NOW); // → closed
    expect(doc.moves.t1?.d3?.collected_forecast).toBeUndefined();
    goto(doc, "d9", "intake");
    advance(doc, NOW);
    expect(doc.moves.t2.d9.cola_price).toMatchObject({ value: 6, source: "default" });
  });

  it("продление снимает подставленные значения; ведущий может поменять ход до раскрытия", () => {
    const doc = session("rink_tea");
    goto(doc, "fri", "closed");
    expect(doc.moves.t1.fri.thermoses.source).toBe("default");
    reopen(doc);
    expect(doc.play.phase).toBe("intake");
    expect(doc.moves.t1.fri.thermoses).toBeUndefined();
    advance(doc, NOW);
    override(doc, "t1", "thermoses", "3", NOW);
    expect(doc.moves.t1.fri.thermoses).toMatchObject({ value: 3, source: "trainer" });
    advance(doc, NOW); // → results
    expect(() => override(doc, "t1", "thermoses", 1, NOW)).toThrow(/до раскрытия/);
  });
});

describe("два указателя: шаг игры и показ", () => {
  it("показ прошлого слайда не меняет шаг игры и приём ходов", () => {
    const doc = session("lemonade");
    goto(doc, "d3", "results");
    goto(doc, "d4", "legend");
    goto(doc, "d5", "legend");
    show(doc, doc.scenario.steps.findIndex((s) => s.id === "d3"), "results");
    expect(stepAt(doc, doc.play.step).id).toBe("d5");
    expect(doc.show.phase).toBe("results");
    expect(() => show(doc, doc.play.step + 1, "legend")).toThrow(/ещё не дошла/);
    expect(() => show(doc, doc.play.step, "results")).toThrow(/не наступила/);
    advance(doc, NOW);
    expect(doc.show).toEqual(doc.play);
  });

  it("показ во время открытого приёма не закрывает приём", () => {
    const doc = session("rink_tea");
    goto(doc, "sat", "intake");
    show(doc, 0, "results");
    submitMove(doc, "t0", "sat", { banner: "banner", thermoses: 5 }, NOW);
    expect(doc.play.phase).toBe("intake");
    expect(showablePhases(doc, doc.play.step)).toEqual(["legend", "intake"]);
  });
});

describe("экраны", () => {
  it("лимонад от начала до конца: проектор, пульт и команды без ошибок; итог эталона 776", () => {
    const doc = session("lemonade");
    const ref: Record<string, string | number> = { "d2.jug": "buy", "d9.cola_price": 7, "d10.flyers": 300, "d11.lemon_price": 9, "d13.flyers": 300, "d14_order.prep": 19 };
    let guard = 0;
    while (!doc.finished && guard++ < 200) {
      const step = stepAt(doc, doc.play.step);
      if (doc.play.phase === "intake") {
        const values: Record<string, unknown> = {};
        for (const inp of step.block.inputs ?? []) {
          const key = `${step.id}.${inp.id}`;
          if (key in ref) values[inp.id] = ref[key];
          else if (inp.type === "quiz" || inp.type === "forecast") values[inp.id] = 4;
        }
        submitMove(doc, "t0", step.id, values, NOW); // t0 — эталонная команда
        if (step.block.inputs?.some((x) => x.type === "choice")) submitMove(doc, "t1", step.id, { [step.block.inputs!.find((x) => x.type === "choice")!.id]: step.block.inputs!.find((x) => x.type === "choice")!.options![0].value }, NOW);
      }
      bump(doc);
      for (const v of [screenView(doc), teamView(doc, doc.teams[0]), teamView(doc, doc.teams[2]), controlView(doc).preview]) {
        const errors = v.blocks.filter((b) => b.type === "error");
        expect(errors, `${step.id} ${doc.play.phase}`).toEqual([]);
      }
      advance(doc, NOW);
    }
    expect(doc.finished).toBe(true);
    bump(doc);
    const t0 = teamView(doc, doc.teams[0]);
    const dayRows = (t0.days as any).rows as string[][];
    expect(dayRows.at(-1)!.at(-1)).toMatch(/776/);
    expect(t0.reports.length).toBeGreaterThan(0);
    expect(isRevealed(doc, doc.scenario.steps.length - 1)).toBe(true);
  });

  it("результаты не видны до раскрытия, вывод — только где размечен", () => {
    const doc = session("rink_tea");
    goto(doc, "fri", "intake");
    const v = teamView(bump(doc), doc.teams[0]);
    expect(v.blocks.some((b) => b.type === "form")).toBe(true);
    expect(v.blocks.some((b) => b.type === "table")).toBe(false);
    expect(phasesOf(stepAt(doc, 0))).not.toContain("debrief");
  });
});

describe("хранилище", () => {
  it("параллельные изменения одной сессии не теряются", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mil-store-"));
    const store = new FileStore(dir);
    const doc = session("rink_tea", []);
    await store.create(doc);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => store.update("TEST1", (d) => addTeam(d, `Команда ${i}`, `id${i}`, `tok${i}`, NOW))));
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(12);
    const saved = await store.get("TEST1");
    expect(saved!.teams).toHaveLength(8); // максимум сценария
    expect(saved!.version).toBe(8);
  });
});
