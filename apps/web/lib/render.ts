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

export const accountLabel = (sc: Scenario, a: string) => sc.root.accounts?.[a]?.label ?? ACCOUNT_LABELS[a] ?? a;
export const sourceLabel = (sc: Scenario, s: string) => sc.root.sources?.[s] ?? s;

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
export function fill(sc: Scenario, text: string, ctx: unknown): string {
  return text.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}\s]+)\s*)?\}\}/g, (_m, p: string, f?: string) => fmt(sc, getPath(ctx, p.trim()), f));
}

export function md(sc: Scenario, text: string, ctx: unknown): string {
  const t = fill(sc, text, ctx).trim();
  return t ? (marked.parse(t, { async: false }) as string) : "";
}

export function label(sc: Scenario, value: unknown, options?: { value: string | number; label: string }[]): string {
  const o = options?.find((x) => String(x.value) === String(value));
  return o ? o.label : fmt(sc, value);
}
