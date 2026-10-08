// Ошибки формата указывают на файл и строку — для Markdown и для JSON.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenario } from "../src/compiler/compile.ts";
import { toJson } from "../src/compiler/json.ts";
import { validateScenario } from "../src/validate.ts";
import { REPO, oneStep, writeScenario } from "./helpers.ts";

function diagnose(files: Record<string, string>, id = "t") {
  const { root, dir } = writeScenario(id, files);
  return validateScenario(dir, root).diagnostics.filter((d) => d.severity === "error");
}
const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

const STEP = `duration: {min: 1, max: 1}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: $p.price}
  - use: on_demand_production
    params: {unit_cost: $p.cost}`;

describe("компилятор Markdown", () => {
  it("минимальный сценарий проходит проверку", () => {
    expect(diagnose({ "scenario.md": oneStep(STEP) })).toEqual([]);
  });

  it("E010: заголовок не по форме — с номером строки", () => {
    const md = oneStep(STEP).replace("## step s1 · Шаг", "## step s1 - Шаг");
    const [e] = diagnose({ "scenario.md": md });
    expect(e).toMatchObject({ code: "E010", pos: { file: "scenarios/t/scenario.md", line: lineOf(md, "## step s1 - Шаг") } });
  });

  it("E021: неизвестное поле в блоке — строка ключа", () => {
    const md = oneStep(STEP + "\nrounds: 3");
    const [e] = diagnose({ "scenario.md": md });
    expect(e.code).toBe("E021");
    expect(e.message).toContain("rounds");
    expect(e.pos!.line).toBe(lineOf(md, "rounds: 3"));
  });

  it("E020: якоря YAML запрещены; дубликат ключа — ошибка", () => {
    expect(diagnose({ "scenario.md": oneStep(STEP + "\ntrainer: &a {protected: true}") })[0].code).toBe("E020");
    expect(diagnose({ "scenario.md": oneStep(STEP + "\nduration: {min: 2, max: 2}") })[0].code).toBe("E020");
  });

  it("E030: неизвестная механика; E040: нет параметра; E041: ссылка на будущий шаг", () => {
    expect(diagnose({ "scenario.md": oneStep(STEP.replace("use: funnel", "use: funnell")) })[0].code).toBe("E030");
    const md = oneStep(STEP.replace("$p.price", "$p.prise"));
    const [e] = diagnose({ "scenario.md": md });
    expect(e).toMatchObject({ code: "E040" });
    expect(e.pos!.line).toBe(lineOf(md, "$p.prise"));
    expect(diagnose({ "scenario.md": oneStep(STEP.replace("$p.price", "$at.s1.cash")) })[0].code).toBe("E041");
  });

  it("E031 на пути: параметр не прошёл схему механики после подстановки", () => {
    const [e] = diagnose({ "scenario.md": oneStep(STEP.replace("conversion: 0.5", "conversion: 5")) });
    expect(e).toMatchObject({ code: "E031" });
    expect(e.message).toContain("conversion");
  });

  it("E043 и E044: у решения нет default; механика ссылается на квиз", () => {
    const noDefault = STEP + `\ninputs:\n  - {id: c, type: choice, label: Выбор, options: [{value: 1, label: a}, {value: 2, label: b}]}`;
    expect(diagnose({ "scenario.md": oneStep(noDefault) }).map((d) => d.code)).toContain("E043");
    const quizRef = STEP.replace("traffic: 10", "traffic: $input.q") + `\ninputs:\n  - {id: q, type: quiz, label: Вопрос, answer: 3}`;
    expect(diagnose({ "scenario.md": oneStep(quizRef) }).map((d) => d.code)).toContain("E044");
  });

  it("default у квиза запрещён", () => {
    const quiz = STEP + `\ninputs:\n  - {id: q, type: quiz, label: Вопрос, answer: 3, default: 3}`;
    expect(diagnose({ "scenario.md": oneStep(quiz) })[0].code).toBe("E021");
  });

  it("E014: нет файла картинки; E080: неизвестная подстановка; E060: бюджет", () => {
    expect(diagnose({ "scenario.md": oneStep(STEP + "\nlegend: {image: assets/x.png}") })[0].code).toBe("E014");
    expect(diagnose({ "scenario.md": oneStep(STEP + "\nlegend: {image: assets/x.png}"), "assets/x.png": "png" })).toEqual([]);
    expect(diagnose({ "scenario.md": oneStep(STEP).replace("Вводная.", "Цена {{p.nope}}.") })[0].code).toBe("E080");
    expect(diagnose({ "scenario.md": oneStep(STEP.replace("{min: 1, max: 1}", "{min: 1, max: 61}")) })[0].code).toBe("E060");
  });

  it("E071: проверка не совпала — с ожидаемым и полученным", () => {
    const md = oneStep(STEP).replace("expect: {at.s1.check.balance: 0}", "expect: {at.s1.pl.day: 999}");
    const [e] = diagnose({ "scenario.md": md });
    expect(e.code).toBe("E071");
    expect(e.message).toContain("ожидалось 999, получено 30");
  });
});

describe("второй вход: scenario.json", () => {
  it("ошибки JSON тоже со строкой", () => {
    const json = `{\n  "meta": {"id": "t", "version": 1, "title": "Т", "locale": "ru", "duration_min": 9, "format": 1, "library": 1},\n  "root": {"currency": {"label": "м"}, "params": {}, "reference": "r", "bogus": 1},\n  "steps": []\n}`;
    const [e] = diagnose({ "scenario.json": json });
    expect(e).toMatchObject({ code: "E021", pos: { file: "scenarios/t/scenario.json", line: 3 } });
    expect(e.message).toContain("bogus");
  });

  it("scenario.md и scenario.json вместе — ошибка", () => {
    expect(diagnose({ "scenario.md": oneStep(STEP), "scenario.json": "{}" })[0].code).toBe("E001");
  });

  it.each(fs.readdirSync(path.join(REPO, "scenarios")).filter((d) => fs.existsSync(path.join(REPO, "scenarios", d, "scenario.md"))))(
    "%s: Markdown → JSON → тот же сценарий",
    (id) => {
      const fromMd = compileScenario(path.join(REPO, "scenarios", id), REPO).scenario!;
      const json = JSON.stringify(toJson(fromMd), null, 2);
      const { root, dir } = writeScenario(id, { "scenario.json": json });
      const fromJson = compileScenario(dir, root);
      expect(fromJson.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const strip = (s: object) => JSON.parse(JSON.stringify(s, (k, v) => (k === "pos" || k === "sourcemap" || k === "dir" ? undefined : v)));
      expect(strip(fromJson.scenario!)).toEqual(strip({ ...fromMd, meta: { ...fromMd.meta, include: undefined } }));
    },
  );
});
