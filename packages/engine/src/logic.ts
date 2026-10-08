// Значения и выражения сценария: ссылки "$…", {expr: JSONLogic}, три операции
// платформы. docs/scenario-format.md, п. 6.
import jsonLogic from "json-logic-js";
import type { Json } from "./types.ts";

/** Округление «половина вверх». Эпсилон гасит ошибки двоичной арифметики: 37.5 → 38. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

type Row = { value: unknown } & Record<string, unknown>;

function arg(rows: Row[], field: string, better: (a: number, b: number) => boolean): unknown {
  let best: { v: number; value: unknown } | null = null;
  for (const r of rows) {
    const v = getPath(r, field);
    if (typeof v !== "number") continue;
    if (best === null || better(v, best.v)) best = { v, value: r.value };
  }
  return best?.value ?? null;
}

jsonLogic.add_operation("round", (x: number) => roundHalfUp(x));
jsonLogic.add_operation("argmax", (rows: Row[], field: string) => arg(rows, field, (a, b) => a > b));
jsonLogic.add_operation("argmin", (rows: Row[], field: string) => arg(rows, field, (a, b) => a < b));

export const PLATFORM_OPERATIONS = ["round", "argmax", "argmin"];

// Белый список: только чистые операции без побочных эффектов. Встроенная `log`
// пишет в консоль — её в движке нет.
jsonLogic.rm_operation("log");
export const ALLOWED_OPERATIONS = new Set([
  "var", "==", "===", "!=", "!==", "!", "!!", "and", "or", "if", "?:",
  "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "min", "max",
  "in", "cat", "substr", "merge", "all", "some", "none", "map", "filter", "reduce",
  ...PLATFORM_OPERATIONS,
]);

export class LogicError extends Error {}

/** Ошибки формы выражения: неизвестная операция, объект не из одного ключа. Путь — JSON-указатель внутри выражения. */
export function logicProblems(rule: unknown, ptr = ""): { ptr: string; message: string }[] {
  if (Array.isArray(rule)) return rule.flatMap((x, i) => logicProblems(x, `${ptr}/${i}`));
  if (!rule || typeof rule !== "object") return [];
  const keys = Object.keys(rule);
  if (keys.length !== 1) return [{ ptr, message: `выражение должно быть объектом из одной операции, а в нём ключи: ${keys.join(", ") || "нет"}` }];
  const op = keys[0];
  if (!ALLOWED_OPERATIONS.has(op))
    return [{ ptr: `${ptr}/${op}`, message: `неизвестная операция «${op}»; доступны: ${[...ALLOWED_OPERATIONS].join(", ")}` }];
  return logicProblems((rule as Record<string, unknown>)[op], `${ptr}/${op}`);
}

/** Переменная без значения по умолчанию, которой нет в данных. */
class MissingVar extends Error {
  constructor(public path: string) {
    super(path);
  }
}

/**
 * Строгий var: то же, что встроенный в JSONLogic, но отсутствующий путь без
 * значения по умолчанию — ошибка, а не тихий null (иначе условие стало бы ложным
 * и механика с when незаметно пропустилась бы). Проверка идёт во время
 * вычисления, поэтому учитывает только реально вычисляемые ветки: невыбранная
 * ветка if, хвост and/or после досрочного выхода, элементы map/filter — как в JSONLogic.
 */
jsonLogic.add_operation("var", function (this: unknown, a: unknown, b?: unknown) {
  const hasDefault = arguments.length > 1;
  const notFound = () => {
    if (hasDefault) return b;
    throw new MissingVar(String(a));
  };
  let data: unknown = this;
  if (a === undefined || a === "" || a === null) return data;
  for (const key of String(a).split(".")) {
    if (data === null || data === undefined) return notFound();
    data = (data as Record<string, unknown>)[key];
    if (data === undefined) return notFound();
  }
  return data;
});

export function evalLogic(rule: Json, data: unknown): unknown {
  const problems = logicProblems(rule);
  if (problems.length) throw new LogicError(problems[0].message);
  try {
    return jsonLogic.apply(rule as never, data as never);
  } catch (e) {
    if (e instanceof MissingVar) throw new RefError(`$${e.path}`);
    throw new LogicError(`выражение не вычислилось: ${(e as Error).message}`);
  }
}

/** Все выражения {expr: …} внутри значения, с указателями. */
export function exprsIn(v: unknown, ptr = ""): { rule: unknown; ptr: string }[] {
  if (isExpr(v)) return [{ rule: v.expr, ptr: `${ptr}/expr` }];
  if (Array.isArray(v)) return v.flatMap((x, i) => exprsIn(x, `${ptr}/${i}`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => exprsIn(x, `${ptr}/${k}`));
  return [];
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export class RefError extends Error {
  constructor(public ref: string) {
    super(`ссылка ${ref} не найдена`);
  }
}

export function isRef(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("$") && !v.startsWith("$$");
}

export function isExpr(v: unknown): v is { expr: Json } {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "expr" in v;
}

/** Подставляет ссылки и выражения во всём значении. */
export function resolveValue(v: Json | undefined, data: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === "string" && v.startsWith("$$")) return v.slice(1);
  if (isRef(v)) {
    const got = getPath(data, v.slice(1));
    if (got === undefined) throw new RefError(v);
    return got;
  }
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, data));
  if (isExpr(v)) return evalLogic(v.expr, data);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = resolveValue(x, data);
    return out;
  }
  return v;
}

/** Все пути переменных в значении: ссылки "$a.b" и {var: "a.b"} внутри expr. */
export function collectRefs(v: unknown, out: string[] = [], inExpr = false): string[] {
  if (isRef(v) && !inExpr) out.push(v.slice(1));
  else if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out, inExpr));
  else if (v && typeof v === "object") {
    if (inExpr && "var" in v) {
      const target = (v as { var: unknown }).var;
      const path = Array.isArray(target) ? target[0] : target;
      if (typeof path === "string" && path !== "") out.push(path);
    }
    if (isExpr(v)) collectRefs(v.expr, out, true);
    else for (const x of Object.values(v)) collectRefs(x, out, inExpr);
  }
  return out;
}
