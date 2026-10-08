// Таблица вариантов: эталонный путь, в котором меняется одно решение
// (docs/scenario-format.md, п. 5.7). Нужна и приложению, и проверке.
import { EngineError, pathData, runPath, type PathResult } from "./engine.ts";
import { resolveValue } from "./logic.ts";
import type { Decisions, Json, Scenario, VariantDef } from "./types.ts";

export interface VariantRow {
  value: string | number;
  label: string;
  cells: unknown[];
}

export function variantValues(sc: Scenario, variant: VariantDef): (string | number)[] {
  const [stepId, inputId] = variant.input.split(".");
  const inp = sc.steps.find((s) => s.id === stepId)?.block.inputs?.find((i) => i.id === inputId);
  if (!inp) throw new EngineError("E040", `variants.input ${variant.input} не найден`, stepId);
  if (variant.values === "options") {
    if (!inp.options) throw new EngineError("E040", `values: options допустимо только для choice (${variant.input})`, stepId);
    return inp.options.map((o) => o.value);
  }
  return variant.values;
}

export function variantRows(sc: Scenario, base: Decisions, variant: VariantDef, run: (d: Decisions) => PathResult = (d) => runPath(sc, d)): VariantRow[] {
  const [stepId, inputId] = variant.input.split(".");
  const inp = sc.steps.find((s) => s.id === stepId)!.block.inputs!.find((i) => i.id === inputId)!;
  return variantValues(sc, variant).map((value) => {
    const r = run({ ...base, [variant.input]: value });
    const data = pathData(sc, r);
    return {
      value,
      label: inp.options?.find((o) => o.value === value)?.label ?? String(value),
      cells: variant.columns.map((c) => resolveValue(c.value as Json, data)),
    };
  });
}
