// Компилятор: каталог сценария → канонический JSON + карта исходных строк.
import fs from "node:fs";
import path from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { CheckDef, Diagnostic, Frontmatter, Json, LessonDef, PageDef, PhaseDef, Pos, RootBlock, Scenario, Slot, StepBlock, StepDef } from "../types.ts";
import { joinText, parseFile, type RawBlock, type RawFile, type RawSection } from "./parse.ts";
import { compileJson } from "./json.ts";
import { checkSchema, frontmatterSchema, lessonSchema, pageSchema, rootSchema, stepSchema } from "./schemas.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
export const v = {
  frontmatter: ajv.compile(frontmatterSchema),
  root: ajv.compile(rootSchema),
  step: ajv.compile(stepSchema),
  page: ajv.compile(pageSchema),
  lesson: ajv.compile(lessonSchema),
  check: ajv.compile(checkSchema),
};

/** Самая глубокая содержательная ошибка Ajv: без обёрток oneOf/if/anyOf. */
function bestError(errors: ErrorObject[]): ErrorObject {
  const real = errors.filter((e) => !["oneOf", "anyOf", "if", "allOf"].includes(e.keyword));
  const pool = real.length ? real : errors;
  return pool.reduce((a, b) => (b.instancePath.split("/").length > a.instancePath.split("/").length ? b : a));
}

function describe(e: ErrorObject): string {
  switch (e.keyword) {
    case "additionalProperties":
      return `неизвестное поле «${(e.params as { additionalProperty: string }).additionalProperty}»`;
    case "required":
      return `нет обязательного поля «${(e.params as { missingProperty: string }).missingProperty}»`;
    case "enum":
      return `допустимо: ${(e.params as { allowedValues: unknown[] }).allowedValues.map((x) => JSON.stringify(x)).join(", ")}`;
    case "const":
      return `ожидалось ${JSON.stringify((e.params as { allowedValue: unknown }).allowedValue)}`;
    case "not":
      return "недопустимое сочетание полей (например, default у quiz или forecast)";
    default:
      return e.message ?? e.keyword;
  }
}

export function posOf(block: RawBlock, pointer: string): Pos {
  let p = pointer;
  while (p && !(p in block.map)) p = p.slice(0, p.lastIndexOf("/"));
  return block.map[p] ?? block.pos;
}

export function check(validate: ValidateFunction, block: RawBlock, where: string, diags: Diagnostic[]): boolean {
  if (validate(block.data)) return true;
  const e = bestError(validate.errors!);
  const extra = e.keyword === "additionalProperties" ? `/${(e.params as { additionalProperty: string }).additionalProperty}` : "";
  const ptr = e.instancePath + extra;
  diags.push({
    code: "E021",
    severity: "error",
    message: `${ptr ? ptr.slice(1).replaceAll("/", ".") + ": " : ""}${describe(e)}`,
    where,
    pos: posOf(block, ptr),
  });
  return false;
}

export interface CompileResult {
  scenario?: Scenario;
  diagnostics: Diagnostic[];
  files: string[];
}

/** Каталог сценария: scenario.md (Markdown) или scenario.json — ровно один из них. */
export function compileScenario(dir: string, root = process.cwd()): CompileResult {
  const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");
  const md = path.join(dir, "scenario.md");
  const json = path.join(dir, "scenario.json");
  const hasMd = fs.existsSync(md);
  const hasJson = fs.existsSync(json);
  const at = { file: rel(dir), line: 1, col: 1 };
  if (hasMd && hasJson)
    return { diagnostics: [{ code: "E001", severity: "error", message: "в каталоге и scenario.md, и scenario.json — оставьте один", pos: at }], files: [md, json] };
  if (hasJson) return compileJson(dir, root);
  if (!hasMd) return { diagnostics: [{ code: "E001", severity: "error", message: "нет scenario.md или scenario.json", pos: at }], files: [] };
  return compileMarkdown(dir, root);
}

function compileMarkdown(dir: string, root: string): CompileResult {
  const diags: Diagnostic[] = [];
  const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");
  const entry = path.join(dir, "scenario.md");
  const files: string[] = [entry];
  const main = parseFile(rel(entry), fs.readFileSync(entry, "utf8"), true, diags);
  if (!main.frontmatter) return { diagnostics: diags, files };
  if (!check(v.frontmatter, main.frontmatter, "фронтматтер", diags)) return { diagnostics: diags, files };
  const meta = main.frontmatter.data as unknown as Frontmatter;
  if (meta.id !== path.basename(dir))
    diags.push({ code: "E002", severity: "error", message: `id «${meta.id}» не совпадает с именем каталога «${path.basename(dir)}»`, pos: posOf(main.frontmatter, "/id") });

  const parsed: RawFile[] = [main];
  for (const inc of meta.include ?? []) {
    const f = path.join(dir, inc);
    files.push(f);
    if (!fs.existsSync(f)) {
      diags.push({ code: "E001", severity: "error", message: `include: нет файла ${inc}`, pos: posOf(main.frontmatter, "/include") });
      continue;
    }
    parsed.push(parseFile(rel(f), fs.readFileSync(f, "utf8"), false, diags));
  }

  if (!main.root) {
    diags.push({ code: "E021", severity: "error", message: "нет корневого блока sim между фронтматтером и первым заголовком", pos: { file: rel(entry), line: 1, col: 1 } });
    return { diagnostics: diags, files };
  }
  if (!check(v.root, main.root, "корневой блок", diags)) return { diagnostics: diags, files };

  const sourcemap: Record<string, Pos> = {};
  const register = (prefix: string, block: RawBlock) => {
    for (const [ptr, pos] of Object.entries(block.map)) sourcemap[prefix + ptr] = pos;
    sourcemap[prefix] = block.pos;
  };
  register("root", main.root);

  const phases: PhaseDef[] = [];
  const steps: StepDef[] = [];
  const pages: PageDef[] = [];
  const lessons: LessonDef[] = [];
  const checks: CheckDef[] = [];
  const seen = new Map<string, Pos>();
  const unique = (kind: string, s: RawSection) => {
    const key = `${kind === "phase" ? "phase" : kind}:${s.id}`;
    if (seen.has(key)) {
      const first = seen.get(key)!;
      diags.push({ code: "E012", severity: "error", message: `повтор ${kind} ${s.id}; первый — ${first.file}:${first.line}`, pos: s.pos });
      return false;
    }
    seen.set(key, s.pos);
    return true;
  };
  const slots = (s: RawSection): Slot[] => s.slots.map((x) => ({ name: x.name, cond: x.cond, text: joinText(x.text), pos: x.pos }));
  const needBlock = (s: RawSection) => {
    if (!s.block) diags.push({ code: "E021", severity: "error", message: `у раздела ${s.kind} ${s.id} нет блока sim`, pos: s.pos });
    return !!s.block;
  };

  for (const file of parsed)
    for (const s of file.sections) {
      if (s.kind === "phase") {
        if (!unique("phase", s)) continue;
        if (s.block) diags.push({ code: "E021", severity: "error", message: "у фазы не бывает блока sim", pos: s.block.pos });
        phases.push({ id: s.id!, title: s.title!, text: joinText(s.text), slots: slots(s), pos: s.pos });
      } else if (s.kind === "step") {
        if (!unique("step", s) || !needBlock(s)) continue;
        const where = `step ${s.id}`;
        if (!check(v.step, s.block!, where, diags)) continue;
        register(`step:${s.id}`, s.block!);
        steps.push({ id: s.id!, title: s.title!, phase: s.parent!.id!, legend: joinText(s.text), slots: slots(s), block: s.block!.data as unknown as StepBlock, pos: s.pos });
      } else if (s.kind === "page") {
        if (!unique("page", s)) continue;
        if (s.block && !check(v.page, s.block, `page ${s.id}`, diags)) continue;
        if (s.block) register(`page:${s.id}`, s.block);
        pages.push({ id: s.id!, title: s.title!, text: joinText(s.text), from: (s.block?.data as { from?: string } | undefined)?.from, pos: s.pos });
      } else if (s.kind === "lesson") {
        if (!unique("lesson", s) || !needBlock(s)) continue;
        if (!check(v.lesson, s.block!, `lesson ${s.id}`, diags)) continue;
        register(`lesson:${s.id}`, s.block!);
        lessons.push({ id: s.id!, title: s.title!, text: joinText(s.text), ...(s.block!.data as object), pos: s.pos } as LessonDef);
      } else if (s.kind === "check") {
        if (!unique("check", s) || !needBlock(s)) continue;
        if (!check(v.check, s.block!, `check ${s.id}`, diags)) continue;
        register(`check:${s.id}`, s.block!);
        checks.push({ id: s.id!, title: s.title!, ...(s.block!.data as object), pos: s.pos } as CheckDef);
      }
    }

  if (!steps.length) diags.push({ code: "E021", severity: "error", message: "в сценарии нет ни одного шага", pos: { file: rel(entry), line: 1, col: 1 } });

  const scenario: Scenario = {
    meta,
    dir,
    description: joinText(main.description),
    root: main.root.data as unknown as RootBlock,
    phases,
    steps,
    pages,
    lessons,
    checks,
    sourcemap,
  };
  return { scenario, diagnostics: diags, files };
}

export type { Json };
