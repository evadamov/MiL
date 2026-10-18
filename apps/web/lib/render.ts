// Текст и числа для экранов: подстановки {{путь | формат}}, Markdown → HTML,
// форматы чисел, подписи счетов и показателей. Словарь подписей — интерфейс
// платформы; сценарий может переименовать счета (root.accounts) и источники.
import { getPath, type Scenario } from "@mil/engine";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export const ACCOUNT_LABELS: Record<string, string> = {
  cash: "Деньги",
  receivables: "Дебиторская задолженность",
  inventory: "Запасы",
  equipment: "Оборудование",
  loan: "Займы",
  retained_earnings: "Нераспределённая прибыль",
  revenue: "Выручка",
  cogs: "Себестоимость",
  waste: "Списания",
  bad_debt: "Невозвращённые долги",
  fixed_costs: "Постоянные расходы",
  marketing: "Маркетинг",
};

export const accountLabel = (sc: Scenario, a: string, phase?: string) =>
  (phase && sc.root.accounts?.[a]?.by_phase?.[phase]) || sc.root.accounts?.[a]?.label || ACCOUNT_LABELS[a] || a;
/** Число со значком сценария после него, как у денег: «20 👤». */
export const withIcon = (sc: Scenario, icon: "people" | "unit", text: string) => {
  const i = sc.root.icons?.[icon];
  return i && text !== "—" ? `${text} ${i}` : text;
};
export const sourceLabel = (sc: Scenario, s: string, phase?: string) => {
  const d = sc.root.sources?.[s];
  if (typeof d === "string") return d;
  return (phase && d?.by_phase?.[phase]) || d?.label || s;
};

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function fmt(sc: Scenario, v: unknown, format?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "number") return String(v);
  // Типографский минус вместо дефиса.
  return raw(sc, v, format).replace(/^-/, "−");
}

function raw(sc: Scenario, v: number, format?: string): string {
  switch (format) {
    case "money":
      return `${nf.format(v)} ${sc.root.currency.short ?? sc.root.currency.label}`;
    case "percent":
      return `${Math.round(v * 100)}%`;
    case "percent1":
      return `${(v * 100).toFixed(1).replace(".", ",")}%`;
    case "int":
      return nf.format(Math.round(v));
    default:
      return nf.format(v);
  }
}

/** Подстановки в тексте сценария. Неизвестная переменная → «—» (валидатор её не пропустит). */
const TEMPLATE = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}\s]+)\s*)?\}\}/g;

export function fill(sc: Scenario, text: string, ctx: unknown): string {
  return text.replace(TEMPLATE, (_m, p: string, f?: string) => fmt(sc, getPath(ctx, p.trim()), f));
}

/** Подстановки для общего экрана: значение, одинаковое во всех контекстах, — числом, иначе «…». */
export function mdShared(sc: Scenario, text: string, ctxs: unknown[]): string {
  const t = text
    .replace(TEMPLATE, (_m, p: string, f?: string) => {
      const vals = ctxs.map((c) => fmt(sc, getPath(c, p.trim()), f));
      return vals.every((v) => v === vals[0]) ? vals[0] : "…";
    })
    .trim();
  return t ? (marked.parse(t, { async: false }) as string) : "";
}

export function md(sc: Scenario, text: string, ctx: unknown): string {
  const t = fill(sc, text, ctx).trim();
  return t ? (marked.parse(t, { async: false }) as string) : "";
}

export function label(sc: Scenario, value: unknown, options?: { value: string | number; label: string }[]): string {
  const o = options?.find((x) => String(x.value) === String(value));
  return o ? o.label : fmt(sc, value);
}
