import type { Diagnostic } from "./types.ts";

/** «файл:строка:столбец  КОД  где» и сообщение — для людей и для обратной подачи в ИИ. */
export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.pos ? `${d.pos.file}:${d.pos.line}:${d.pos.col}` : "";
  const head = [loc, d.code, d.where].filter(Boolean).join("  ");
  return [head, `  ${d.message}`, ...(d.details ?? []).map((x) => `  ${x}`)].join("\n");
}
