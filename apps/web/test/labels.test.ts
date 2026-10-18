// Подписи в «Итогах дня»: своя подпись счёта в фазе, одинаковые подписи — одной строкой, дебиторка.
import path from "node:path";
import { compileScenario } from "@mil/engine";
import { describe, expect, it } from "vitest";
import { addTeam, advance, newSession, stepAt, submitMove, type SessionDoc } from "../lib/session";
import { screenView, teamView } from "../lib/views";

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


describe("экраны после прогона 1", () => {
  const two = () => {
    const doc = lemonade();
    addTeam(doc, "Бета", "tb", "t2", NOW);
    return doc;
  };
  const html = (doc: SessionDoc) => screenView(doc).blocks.filter((b) => b.type === "html").map((b: any) => b.html).join("");

  it("приём ходов: вопрос и кто ответил, без самих ответов", () => {
    const doc = two();
    goto(doc, "d2", "intake");
    submitMove(doc, "ta", "d2", { jug: "buy" }, NOW);
    const a = screenView(doc).blocks.find((b) => b.type === "answered") as any;
    expect(a.questions).toEqual(["Покупаем второй кувшин?"]);
    expect(a.teams).toEqual([{ name: "Альфа", done: 1 }, { name: "Бета", done: 0 }]);
  });

  it("общий текст: число, разное у команд, — «…»; одинаковое — числом", () => {
    const doc = two();
    goto(doc, "d2", "intake");
    submitMove(doc, "ta", "d2", { jug: "buy" }, NOW);
    goto(doc, "d5", "results");
    expect(html(doc)).toContain("Купили 18 человек");
  });

  it("прогноз: медиана из двух — среднее; рядом факт", () => {
    const doc = two();
    goto(doc, "d2", "intake");
    submitMove(doc, "ta", "d2", { jug: "buy" }, NOW);
    goto(doc, "d3", "intake");
    submitMove(doc, "ta", "d3", { collected_forecast: 30 }, NOW);
    submitMove(doc, "tb", "d3", { collected_forecast: 60 }, NOW);
    goto(doc, "d3", "results");
    const t = screenView(doc).blocks.find((b) => b.type === "table" && b.title?.startsWith("Сколько монет")) as any;
    expect(t.head).toEqual(["Команда", "Прогноз", "Факт"]);
    expect(t.rows).toEqual([["Альфа", "30 монет", "35 монет"], ["Бета", "60 монет", "20 монет"]]);
    expect(t.note).toContain("медиана 45");
  });

  it("вопрос и вывод — отдельные экраны, вопрос первым", () => {
    const doc = two();
    goto(doc, "d5", "question");
    expect(html(doc)).toContain("почему прибыль меньше");
    expect(html(doc)).not.toContain("Скидку получили все");
    goto(doc, "d5", "debrief");
    expect(html(doc)).toContain("Скидку получили все");
  });

  it("итоги сезона: на проекторе сравнение команд, отчёты — только у команды; ловушки — своим экраном", () => {
    const doc = two();
    goto(doc, "d6", "results");
    const titles = screenView(doc).blocks.map((b: any) => b.title);
    expect(titles).toEqual(["Команды"]);
    goto(doc, "d6", "takeaways");
    const tk = screenView(doc).blocks[0] as any;
    expect(tk).toMatchObject({ title: "Ловушки", text: true });
  });

  it("Cash Flow во дворе: «Платёж маме», как в P&L; без строки проверки баланса", () => {
    const doc = two();
    goto(doc, "d6", "results");
    const t = teamView(doc, doc.teams[0]);
    const rows = t.blocks.flatMap((b: any) => (b.type === "table" ? b.rows.map((r: string[]) => r[0]) : []));
    expect(rows).toContain("Операционная: Платёж маме");
    expect(rows).not.toContain("Проверка баланса");
  });
});

it("mdShared: разные значения — «…», одинаковые — числом", async () => {
  const { mdShared } = await import("../lib/render");
  const sc = compileScenario(path.join(REPO, "scenarios/lemonade"), REPO).scenario!;
  expect(mdShared(sc, "Продано {{a}}, трафик {{b}}", [{ a: 15, b: 35 }, { a: 30, b: 35 }])).toBe("<p>Продано …, трафик 35</p>\n");
});
