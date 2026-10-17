// Подписи в «Итогах дня»: своя подпись счёта в фазе, одинаковые подписи — одной строкой, дебиторка.
import path from "node:path";
import { compileScenario } from "@mil/engine";
import { describe, expect, it } from "vitest";
import { addTeam, advance, newSession, stepAt, submitMove, type SessionDoc } from "../lib/session";
import { screenView } from "../lib/views";

const REPO = path.resolve(import.meta.dirname, "../../..");
const NOW = "2026-10-08T10:00:00.000Z";

function lemonade(): SessionDoc {
  const doc = newSession("LBL", "k", compileScenario(path.join(REPO, "scenarios/lemonade"), REPO).scenario!, {}, NOW);
  addTeam(doc, "Альфа", "ta", "t1", NOW);
  return doc;
}
function goto(doc: SessionDoc, stepId: string, phase: string) {
  while (!(stepAt(doc, doc.play.step).id === stepId && doc.play.phase === phase)) (advance(doc, NOW), doc.version++);
}
const facts = (doc: SessionDoc) => {
  const t = screenView(doc).blocks.find((b) => b.type === "table" && b.title === "Итоги дня") as { rows: string[][] };
  return Object.fromEntries(t.rows.map(([l, v]) => [l, v]));
};

describe("итоги дня во дворе", () => {
  it("себестоимость и списания — одна строка «Платёж маме»: 28 + 2 = 30", () => {
    const doc = lemonade();
    goto(doc, "d1", "results");
    const f = facts(doc);
    expect(f["Платёж маме"]).toBe("−30 🪙");
    expect(f).not.toHaveProperty("Себестоимость");
    expect(f).not.toHaveProperty("Списания");
    expect(f["Прибыль шага"]).toBe("40 🪙");
  });

  it("дебиторка видна, пока долги есть, и в день возврата", () => {
    const doc = lemonade();
    goto(doc, "d2", "intake");
    submitMove(doc, "ta", "d2", { jug: "buy" }, NOW);
    goto(doc, "d2", "results");
    expect(facts(doc)["Дебиторка"]).toBe("80 🪙");
    goto(doc, "d3", "results");
    expect(facts(doc)["Дебиторка"]).toBe("0 🪙");
    goto(doc, "d4", "results");
    expect(facts(doc)).not.toHaveProperty("Дебиторка");
  });
});

