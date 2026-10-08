// Регрессии по ревью коммита c732d55.
import { describe, expect, it } from "vitest";
import { runPath } from "../src/engine.ts";
import { evalLogic, RefError } from "../src/logic.ts";
import { validateScenario } from "../src/validate.ts";
import { compileOk, oneStep, writeScenario } from "./helpers.ts";

const errorsOf = (md: string) => {
  const { root, dir } = writeScenario("t", { "scenario.md": md });
  return validateScenario(dir, root).diagnostics.filter((d) => d.severity === "error");
};

const numberStep = (input: string) =>
  oneStep(`duration: {min: 1, max: 1}
inputs:
  - ${input}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: batch_production
    params: {quantity: $input.n, unit_cost: 4}`);

describe("1. default и samples проходят ту же проверку, что ход", () => {
  it("step: 2, default: 3 — E043 (раньше ноль ошибок, а форма отклонила бы 3)", () => {
    const errs = errorsOf(numberStep("{id: n, type: number, label: Сколько, min: 0, max: 10, step: 2, samples: [2, 4], default: 3}"));
    expect(errs).toEqual([expect.objectContaining({ code: "E043", message: expect.stringContaining("default 3: шаг 2") })]);
  });

  it("sample вне шага или диапазона — E043 с указанием на элемент", () => {
    const md = numberStep("{id: n, type: number, label: Сколько, min: 0, max: 10, step: 2, samples: [2, 5, 12], default: 2}");
    const errs = errorsOf(md);
    expect(errs.map((e) => e.message)).toEqual([expect.stringContaining("samples 5: шаг 2"), expect.stringContaining("samples 12: не больше 10")]);
  });

  it("default у choice не из вариантов — E043", () => {
    const md = oneStep(`duration: {min: 1, max: 1}
inputs:
  - {id: c, type: choice, label: Выбор, options: [{value: a, label: A}, {value: b, label: B}], default: z}`);
    expect(errorsOf(md)[0]).toMatchObject({ code: "E043", message: expect.stringContaining("default \"z\"") });
  });

  it("движок тоже не подставляет некорректный default молча", () => {
    const sc = compileOk("t", { "scenario.md": numberStep("{id: n, type: number, label: Сколько, min: 0, max: 10, step: 2, samples: [2], default: 2}") });
    sc.steps[0].block.inputs![0].default = 3; // в обход проверки сценария
    expect(() => runPath(sc, {})).toThrow(expect.objectContaining({ code: "E043", message: expect.stringContaining("(default)") }));
  });
});

describe("2. условие текста move проверяется в контексте до хода", () => {
  const withSlots = (conditions: string, slots: string) =>
    oneStep(
      `duration: {min: 1, max: 1}
inputs:
  - {id: c, type: choice, label: Выбор, options: [{value: a, label: A}, {value: b, label: B}], default: a}
conditions:
${conditions}
mechanics:
  - use: funnel
    params: {traffic: 10, conversion: 0.5, price: 10}
  - use: on_demand_production
    params: {unit_cost: 4}`,
      "",
      slots,
    );

  it("move (if …) по ходу или продажам текущего шага — E041", () => {
    const byInput = errorsOf(withSlots("  chose_a: {expr: {\"==\": [{var: input.c}, a]}}", "\n### move (if chose_a)\n\nВы выбрали A.\n"));
    expect(byInput).toContainEqual(expect.objectContaining({ code: "E041", message: expect.stringContaining("ещё не сделан") }));
    const bySales = errorsOf(withSlots("  sold: {expr: {\">\": [{var: at.s1.metrics.sold}, 0]}}", "\n### move (if sold)\n\nПродажи были.\n"));
    expect(bySales).toContainEqual(expect.objectContaining({ code: "E041" }));
  });

  it("то же условие в results и debrief — без ошибок: там ход уже сделан", () => {
    const md = withSlots("  chose_a: {expr: {\"==\": [{var: input.c}, a]}}", "\n### results (if chose_a)\n\nВы выбрали A.\n\n### debrief (if chose_a)\n\nРазбор для A.\n");
    expect(errorsOf(md)).toEqual([]);
  });

  it("move (if …) по параметрам и прошлым шагам — без ошибок", () => {
    expect(errorsOf(withSlots("  cheap: {expr: {\"<\": [{var: p.cost}, 10]}}", "\n### move (if cheap)\n\nДёшево.\n"))).toEqual([]);
  });
});

describe("3. строгие переменные — только в вычисляемых ветках", () => {
  it("невыбранная ветка if не проверяется, выбранная — проверяется", () => {
    expect(evalLogic({ if: [true, 1, { var: "missing" }] }, {})).toBe(1);
    expect(() => evalLogic({ if: [false, 1, { var: "missing" }] }, {})).toThrow(RefError);
    expect(evalLogic({ if: [false, 1, { var: "x" }, 2, 3] }, { x: 0 })).toBe(3);
  });

  it("and/or с досрочным выходом не трогают хвост", () => {
    expect(evalLogic({ and: [false, { var: "missing" }] }, {})).toBe(false);
    expect(evalLogic({ or: [true, { var: "missing" }] }, {})).toBe(true);
    expect(() => evalLogic({ and: [true, { var: "missing" }] }, {})).toThrow(RefError);
  });

  it("внутри map/filter переменные — поля элемента", () => {
    expect(evalLogic({ map: [{ var: "xs" }, { "*": [{ var: "" }, 2] }] }, { xs: [1, 2] })).toEqual([2, 4]);
    expect(evalLogic({ filter: [{ var: "xs" }, { ">": [{ var: "v" }, 1] }] }, { xs: [{ v: 1 }, { v: 2 }] })).toEqual([{ v: 2 }]);
    expect(() => evalLogic({ map: [{ var: "xs" }, { var: "nope" }] }, { xs: [{ v: 1 }] })).toThrow(RefError);
  });

  it("значение по умолчанию и null — не ошибка", () => {
    expect(evalLogic({ var: ["missing", 0] }, {})).toBe(0);
    expect(evalLogic({ var: ["missing", null] }, {})).toBe(null);
    expect(evalLogic({ var: "x" }, { x: null })).toBe(null);
  });
});
