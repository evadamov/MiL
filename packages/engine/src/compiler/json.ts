// Второй вход: scenario.json. Та же структура, что даёт разбор Markdown, те же
// схемы и проверки. JSON читается YAML-парсером — так у ошибок есть строка и столбец.
// docs/scenario-format.md, п. 13.
import fs from "node:fs";
import path from "node:path";
import type { CheckDef, Diagnostic, Frontmatter, LessonDef, PageDef, PhaseDef, Pos, RootBlock, Scenario, Slot, StepBlock, StepDef } from "../types.ts";
import { check, type CompileResult, v } from "./compile.ts";
import { parseYamlBlock, type RawBlock } from "./parse.ts";

const SLOT_NAMES = new Set(["move", "results", "debrief", "discussion", "trainer"]);
const ID = /^[a-z][a-z0-9_]*$/;
const TOP_KEYS = new Set(["meta", "description", "root", "phases", "steps", "pages", "lessons", "checks"]);

/** Часть документа как самостоятельный блок: указатели без префикса. */
function sub(block: RawBlock, prefix: string, omit: string[] = []): RawBlock {
  const map: Record<string, Pos> = {};
  for (const [ptr, pos] of Object.entries(block.map)) if (ptr === prefix || ptr.startsWith(prefix + "/")) map[ptr.slice(prefix.length)] = pos;
  let data = prefix.split("/").slice(1).reduce<any>((o, k) => o?.[k], block.data);
  if (data && typeof data === "object" && !Array.isArray(data) && omit.length) data = Object.fromEntries(Object.entries(data).filter(([k]) => !omit.includes(k)));
  return { data, pos: block.map[prefix] ?? block.pos, map };
}

export function compileJson(dir: string, root: string): CompileResult {
  const diags: Diagnostic[] = [];
  const file = path.join(dir, "scenario.json");
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const doc = parseYamlBlock(fs.readFileSync(file, "utf8").replace(/^﻿/, ""), { file: rel, line: 1, col: 1 }, diags);
  const fail = { diagnostics: diags, files: [file] };
  if (!doc) return fail;
  const top = doc.data as Record<string, any>;
  const err = (code: string, message: string, pos: Pos | undefined, where?: string) => diags.push({ code, severity: "error", message, pos: pos ?? doc.pos, where });
  if (!top || typeof top !== "object" || Array.isArray(top)) {
    err("E021", "scenario.json должен быть объектом", doc.pos);
    return fail;
  }
  for (const k of Object.keys(top)) if (!TOP_KEYS.has(k)) err("E021", `неизвестное поле верхнего уровня «${k}»`, doc.map[`/${k}`]);
  for (const k of ["meta", "root", "steps"]) if (!(k in top)) err("E021", `нет поля «${k}»`, doc.pos);
  if (diags.length) return fail;

  const meta = sub(doc, "/meta");
  if (!check(v.frontmatter, meta, "meta", diags)) return fail;
  if ((meta.data as unknown as Frontmatter).include) err("E021", "include бывает только у Markdown-сценария", meta.map["/include"]);
  if ((meta.data as unknown as Frontmatter).id !== path.basename(dir))
    err("E002", `id «${(meta.data as any).id}» не совпадает с именем каталога «${path.basename(dir)}»`, meta.map["/id"]);
  const rootBlock = sub(doc, "/root");
  if (!check(v.root, rootBlock, "root", diags)) return fail;

  const sourcemap: Record<string, Pos> = {};
  const register = (prefix: string, block: RawBlock) => {
    for (const [ptr, pos] of Object.entries(block.map)) sourcemap[prefix + ptr] = pos;
    sourcemap[prefix] = block.pos;
  };
  register("root", rootBlock);

  const list = (key: string): any[] => {
    const x = top[key];
    if (x === undefined) return [];
    if (!Array.isArray(x)) {
      err("E021", `${key} должен быть списком`, doc.map[`/${key}`]);
      return [];
    }
    return x;
  };
  const text = (x: unknown, ptr: string, required = false): string => {
    if (x === undefined && !required) return "";
    if (typeof x !== "string") {
      err("E021", `${ptr.slice(1).replaceAll("/", ".")}: ожидалась строка`, doc.map[ptr]);
      return "";
    }
    if (/<\/?[a-zA-Z][^>]*>/.test(x)) err("E013", "HTML в тексте запрещён", doc.map[ptr]);
    return x.trim();
  };
  const head = (x: any, ptr: string, kind: string, seen: Set<string>): { id: string; title: string; pos: Pos } | null => {
    const pos = doc.map[ptr] ?? doc.pos;
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID.test(x.id)) {
      err("E021", `${kind}: нет id или id не по форме ^[a-z][a-z0-9_]*$`, pos);
      return null;
    }
    if (seen.has(x.id)) {
      err("E012", `повтор ${kind} ${x.id}`, pos);
      return null;
    }
    seen.add(x.id);
    return { id: x.id, title: text(x.title, `${ptr}/title`, true), pos };
  };
  const slots = (x: any, ptr: string): Slot[] => {
    if (x === undefined) return [];
    if (!Array.isArray(x)) {
      err("E021", "slots должен быть списком", doc.map[ptr]);
      return [];
    }
    return x.flatMap((s: any, i: number) => {
      const sp = `${ptr}/${i}`;
      const extra = s && typeof s === "object" ? Object.keys(s).filter((k) => !["name", "cond", "text"].includes(k)) : [];
      if (!s || !SLOT_NAMES.has(s.name)) {
        err("E021", `slots[${i}].name: допустимо ${[...SLOT_NAMES].join(", ")}`, doc.map[sp]);
        return [];
      }
      if (extra.length) err("E021", `slots[${i}]: неизвестное поле «${extra[0]}»`, doc.map[`${sp}/${extra[0]}`]);
      if (s.cond !== undefined && !/^!?[a-z][a-z0-9_]*$/.test(s.cond)) err("E021", `slots[${i}].cond: имя условия`, doc.map[`${sp}/cond`]);
      return [{ name: s.name, cond: s.cond, text: text(s.text, `${sp}/text`, true), pos: doc.map[sp] ?? doc.pos }];
    });
  };

  const phases: PhaseDef[] = [];
  const seenPhase = new Set<string>();
  list("phases").forEach((x, i) => {
    const ptr = `/phases/${i}`;
    const h = head(x, ptr, "phase", seenPhase);
    if (!h) return;
    const extra = Object.keys(x).filter((k) => !["id", "title", "text", "slots"].includes(k));
    if (extra.length) err("E021", `phase ${h.id}: неизвестное поле «${extra[0]}»`, doc.map[`${ptr}/${extra[0]}`]);
    phases.push({ ...h, text: text(x.text, `${ptr}/text`), slots: slots(x.slots, `${ptr}/slots`) });
  });

  const steps: StepDef[] = [];
  const seenStep = new Set<string>();
  list("steps").forEach((x, i) => {
    const ptr = `/steps/${i}`;
    const h = head(x, ptr, "step", seenStep);
    if (!h) return;
    if (!seenPhase.has(x.phase)) {
      err("E040", `step ${h.id}: phase «${x.phase}» не объявлена в phases`, doc.map[`${ptr}/phase`] ?? h.pos);
      return;
    }
    const block = sub(doc, ptr, ["id", "title", "phase", "legend", "slots"]);
    if (!check(v.step, block, `step ${h.id}`, diags)) return;
    register(`step:${h.id}`, block);
    steps.push({ ...h, phase: x.phase, legend: text(x.legend, `${ptr}/legend`), slots: slots(x.slots, `${ptr}/slots`), block: block.data as unknown as StepBlock });
  });

  const pages: PageDef[] = [];
  const seenPage = new Set<string>();
  list("pages").forEach((x, i) => {
    const ptr = `/pages/${i}`;
    const h = head(x, ptr, "page", seenPage);
    if (!h) return;
    const block = sub(doc, ptr, ["id", "title", "text"]);
    if (!check(v.page, block, `page ${h.id}`, diags)) return;
    register(`page:${h.id}`, block);
    pages.push({ ...h, text: text(x.text, `${ptr}/text`), from: x.from });
  });

  const lessons: LessonDef[] = [];
  const seenLesson = new Set<string>();
  list("lessons").forEach((x, i) => {
    const ptr = `/lessons/${i}`;
    const h = head(x, ptr, "lesson", seenLesson);
    if (!h) return;
    const block = sub(doc, ptr, ["id", "title", "text"]);
    if (!check(v.lesson, block, `lesson ${h.id}`, diags)) return;
    register(`lesson:${h.id}`, block);
    lessons.push({ ...h, text: text(x.text, `${ptr}/text`), ...(block.data as object) } as LessonDef);
  });

  const checks: CheckDef[] = [];
  const seenCheck = new Set<string>();
  list("checks").forEach((x, i) => {
    const ptr = `/checks/${i}`;
    const h = head(x, ptr, "check", seenCheck);
    if (!h) return;
    const block = sub(doc, ptr, ["id", "title"]);
    if (!check(v.check, block, `check ${h.id}`, diags)) return;
    register(`check:${h.id}`, block);
    checks.push({ ...h, ...(block.data as object) } as CheckDef);
  });

  if (!steps.length && !diags.length) err("E021", "в сценарии нет ни одного шага", doc.map["/steps"]);
  if (top.description !== undefined) text(top.description, "/description");
  const scenario: Scenario = {
    meta: meta.data as unknown as Frontmatter,
    dir,
    description: typeof top.description === "string" ? top.description.trim() : "",
    root: rootBlock.data as unknown as RootBlock,
    phases,
    steps,
    pages,
    lessons,
    checks,
    sourcemap,
  };
  return { scenario, diagnostics: diags, files: [file] };
}

/** Сценарий в виде scenario.json — для образцов ИИ и обратной проверки. */
export function toJson(sc: Scenario): object {
  const slots = (xs: Slot[]) => (xs.length ? xs.map(({ name, cond, text }) => (cond ? { name, cond, text } : { name, text })) : undefined);
  const { include: _include, ...meta } = sc.meta;
  return {
    meta,
    description: sc.description || undefined,
    root: sc.root,
    phases: sc.phases.map((p) => ({ id: p.id, title: p.title, text: p.text || undefined, slots: slots(p.slots) })),
    steps: sc.steps.map((s) => ({ id: s.id, title: s.title, phase: s.phase, legend: s.legend || undefined, slots: slots(s.slots), ...s.block })),
    pages: sc.pages.length ? sc.pages.map((p) => ({ id: p.id, title: p.title, text: p.text, from: p.from })) : undefined,
    lessons: sc.lessons.map(({ pos: _p, ...l }) => ({ ...l, text: l.text || undefined })),
    checks: sc.checks.map(({ pos: _p, ...c }) => c),
  };
}
