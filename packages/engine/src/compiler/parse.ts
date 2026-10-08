// Разбор Markdown сценария на разделы-директивы. Сам Markdown прозы не
// интерпретируется: важны только заголовки уровней 1–3 и fenced-блоки `sim`.
// docs/scenario-format.md, п. 3.
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseAllDocuments, type Node } from "yaml";
import type { Diagnostic, Json, Pos } from "../types.ts";

export interface RawBlock {
  data: Json;
  pos: Pos;
  /** JSON-указатель внутри блока ("/mechanics/1/params") → позиция. */
  map: Record<string, Pos>;
}

export interface RawSection {
  level: 1 | 2;
  kind: string;
  id?: string;
  title?: string;
  pos: Pos;
  /** Основной текст и слоты ###. */
  text: string[];
  slots: { name: string; cond?: string; text: string[]; pos: Pos }[];
  block?: RawBlock;
  parent?: RawSection;
}

export interface RawFile {
  file: string;
  frontmatter?: RawBlock;
  description: string[];
  root?: RawBlock;
  sections: RawSection[];
}

const H1 = /^# (phase|info|lessons|checks)(?: ([a-z][a-z0-9_]*))?(?: · (.+))?$/;
const H2 = /^## (step|page|lesson|check) ([a-z][a-z0-9_]*) · (.+)$/;
const H3 = /^### (move|results|debrief|discussion|trainer)(?: \(if (!?[a-z][a-z0-9_]*)\))?$/;
const H2_PARENT: Record<string, string> = { step: "phase", page: "info", lesson: "lessons", check: "checks" };
const FENCE = /^(`{3,}|~{3,})\s*([^`\s]*)\s*$/;

function hint(line: string): string {
  if (line.startsWith("### ")) return "### move | results | debrief | discussion | trainer [(if <условие>)]";
  if (line.startsWith("## ")) return "## step|page|lesson|check <id> · <название>";
  return "# phase <id> · <название> | # info | # lessons | # checks";
}

/** YAML 1.2 core, без якорей, ссылок, тегов, merge и нескольких документов. */
export function parseYamlBlock(src: string, start: Pos, diags: Diagnostic[]): RawBlock | undefined {
  const lc = new LineCounter();
  const docs = parseAllDocuments(src, { lineCounter: lc, uniqueKeys: true, merge: false, schema: "core", prettyErrors: false });
  const at = (offset: number): Pos => {
    const lp = lc.linePos(offset);
    return { file: start.file, line: start.line + lp.line - 1, col: lp.col };
  };
  const list = Array.isArray(docs) ? docs : [docs];
  if (list.length > 1) {
    diags.push({ code: "E020", severity: "error", message: "в блоке sim больше одного YAML-документа", pos: start });
    return undefined;
  }
  const doc = list[0];
  if (!doc) return { data: {}, pos: start, map: {} };
  if (doc.errors.length) {
    const e = doc.errors[0];
    diags.push({ code: "E020", severity: "error", message: `не YAML: ${e.message.split("\n")[0]}`, pos: at(e.pos[0]) });
    return undefined;
  }
  const map: Record<string, Pos> = {};
  let bad = false;
  const walk = (node: unknown, ptr: string) => {
    if (!node) return;
    if (isAlias(node)) {
      diags.push({ code: "E020", severity: "error", message: "ссылки YAML (*alias) запрещены", pos: at(node.range![0]) });
      bad = true;
      return;
    }
    const n = node as Node;
    if (n.range) map[ptr] = at(n.range[0]);
    if ((n as { anchor?: string }).anchor) {
      diags.push({ code: "E020", severity: "error", message: "якоря YAML (&anchor) запрещены", pos: at(n.range![0]) });
      bad = true;
    }
    // У разобранного узла tag есть, только если он явно указан в тексте.
    if (n.tag) {
      diags.push({ code: "E020", severity: "error", message: `теги YAML запрещены: ${n.tag}`, pos: at(n.range![0]) });
      bad = true;
    }
    if (isMap(n))
      for (const pair of n.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const kptr = `${ptr}/${key}`;
        if (isScalar(pair.key) && pair.key.range) map[kptr] = at(pair.key.range[0]);
        walk(pair.value, kptr);
      }
    else if (isSeq(n)) n.items.forEach((it, i) => walk(it, `${ptr}/${i}`));
  };
  walk(doc.contents, "");
  if (bad) return undefined;
  return { data: (doc.toJS() ?? {}) as Json, pos: start, map };
}

export function parseFile(file: string, source: string, isEntry: boolean, diags: Diagnostic[]): RawFile {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: RawFile = { file, description: [], sections: [] };
  let i = 0;
  const pos = (line: number, col = 1): Pos => ({ file, line, col });

  if (isEntry) {
    if (lines[0] !== "---") diags.push({ code: "E001", severity: "error", message: "scenario.md должен начинаться с фронтматтера ---", pos: pos(1) });
    else {
      const end = lines.indexOf("---", 1);
      if (end < 0) diags.push({ code: "E001", severity: "error", message: "фронтматтер не закрыт строкой ---", pos: pos(1) });
      else {
        out.frontmatter = parseYamlBlock(lines.slice(1, end).join("\n"), pos(2), diags);
        i = end + 1;
      }
    }
  }

  let h1: RawSection | undefined;
  let cur: RawSection | undefined;
  let slot: RawSection["slots"][number] | undefined;
  const textSink = () => (slot ? slot.text : cur ? cur.text : out.description);

  for (; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      const [, ticks, info] = fence;
      const startLine = i + 1;
      let j = i + 1;
      while (j < lines.length) {
        const close = lines[j].match(/^(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === ticks[0] && close[1].length >= ticks.length) break;
        j++;
      }
      if (j >= lines.length) diags.push({ code: "E020", severity: "error", message: "блок кода не закрыт", pos: pos(startLine) });
      const body = lines.slice(i + 1, j);
      if (info === "sim") {
        const block = parseYamlBlock(body.join("\n"), pos(startLine + 1), diags);
        const target = cur ?? (isEntry && !h1 ? undefined : null);
        if (target === undefined) {
          if (out.root) diags.push({ code: "E021", severity: "error", message: "второй корневой блок sim", pos: pos(startLine) });
          else if (block) out.root = { ...block, pos: pos(startLine) };
        } else if (target === null)
          diags.push({ code: "E021", severity: "error", message: "блок sim вне раздела: он должен идти под заголовком ## или # phase", pos: pos(startLine) });
        else if (target.block) diags.push({ code: "E021", severity: "error", message: `второй блок sim в разделе ${target.id ?? target.kind}`, pos: pos(startLine) });
        else if (block) target.block = { ...block, pos: pos(startLine) };
      } else textSink().push(...lines.slice(i, Math.min(j + 1, lines.length)));
      i = j;
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      let m: RegExpMatchArray | null;
      if ((m = line.match(H1))) {
        const [, kind, id, title] = m;
        if (kind === "phase" && (!id || !title)) {
          diags.push({ code: "E010", severity: "error", message: `фаза без id или названия: ${line}`, details: [`ожидалось: ${hint(line)}`], pos: pos(i + 1) });
          continue;
        }
        h1 = { level: 1, kind, id, title, pos: pos(i + 1), text: [], slots: [] };
        out.sections.push(h1);
        cur = kind === "phase" ? h1 : undefined;
        slot = undefined;
      } else if ((m = line.match(H2))) {
        const [, kind, id, title] = m;
        if (!h1 || h1.kind !== H2_PARENT[kind]) {
          diags.push({ code: "E011", severity: "error", message: `## ${kind} должен быть внутри # ${H2_PARENT[kind]}`, pos: pos(i + 1) });
          cur = undefined;
          slot = undefined;
          continue;
        }
        cur = { level: 2, kind, id, title, pos: pos(i + 1), text: [], slots: [], parent: h1 };
        out.sections.push(cur);
        slot = undefined;
      } else if ((m = line.match(H3))) {
        if (!cur || (cur.kind !== "step" && cur.kind !== "phase")) {
          diags.push({ code: "E011", severity: "error", message: "### слот допустим только внутри шага или фазы", pos: pos(i + 1) });
          continue;
        }
        slot = { name: m[1], cond: m[2], text: [], pos: pos(i + 1) };
        cur.slots.push(slot);
      } else diags.push({ code: "E010", severity: "error", message: `заголовок не по форме: ${line}`, details: [`ожидалось: ${hint(line)}`], pos: pos(i + 1) });
      continue;
    }
    if (/<\/?[a-zA-Z][^>]*>/.test(line)) diags.push({ code: "E013", severity: "error", message: "HTML в тексте запрещён", pos: pos(i + 1) });
    textSink().push(line);
  }
  return out;
}

export const joinText = (lines: string[]) => lines.join("\n").trim();
