// Общие типы движка. Описание — docs/engine.md, docs/scenario-format.md.

export interface Pos {
  file: string;
  line: number;
  col: number;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  pos?: Pos;
  /** Где в сценарии: «step d13 › mechanics[1] › params.tiers». */
  where?: string;
  /** Пути и числа для ошибок, зависящих от ходов. */
  details?: string[];
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** Значение в блоке: литерал, ссылка "$…" или {expr: JSONLogic}. */
export type Value = Json;
export type Condition = string | { expr: Json };

export type InputType = "choice" | "number" | "quiz" | "forecast";

export interface InputDef {
  id: string;
  type: InputType;
  label: string;
  /** Поле доступно только если условие по уже пройденным шагам истинно. */
  when?: Condition;
  options?: { value: string | number; label: string }[];
  /** Число или ссылка/выражение по данным команды до хода. */
  min?: number | Value;
  max?: number | Value;
  step?: number;
  unit?: string;
  samples?: number[];
  default?: string | number;
  answer?: Value;
  /** forecast: фактическое значение после раскрытия — для сравнения с прогнозом. */
  actual?: Value;
  tolerance?: number;
  explain?: string;
}

export interface MechanicCall {
  use: string;
  id?: string;
  when?: Condition;
  params?: JsonObject;
}

export interface VariantDef {
  id: string;
  input: string;
  values: "options" | (string | number)[];
  columns: { label: string; value: Value; format?: string }[];
}

export interface StepBlock {
  duration: { min: number; max: number };
  type?: "summary";
  legend?: { image?: string; layout?: "side" | "below" | "full" | "text" };
  inputs?: InputDef[];
  mechanics?: MechanicCall[];
  results?: { panels: Json[] };
  variants?: VariantDef[];
  tables?: Record<string, Json>;
  conditions?: Record<string, Condition>;
  trainer?: { checkpoint?: string; protected?: boolean };
}

export interface Slot {
  name: string;
  cond?: string;
  text: string;
  pos: Pos;
}

export interface StepDef {
  id: string;
  title: string;
  phase: string;
  /** Текст вводной — до первого ###. */
  legend: string;
  slots: Slot[];
  block: StepBlock;
  pos: Pos;
}

export interface PhaseDef {
  id: string;
  title: string;
  text: string;
  slots: Slot[];
  pos: Pos;
}

export interface PageDef {
  id: string;
  title: string;
  text: string;
  from?: string;
  pos: Pos;
}

export interface LessonDef {
  id: string;
  title: string;
  text: string;
  phase?: string;
  takeaway?: boolean;
  kind: "path" | "contrast" | "sweep" | "unverified";
  assert?: Json;
  contrast?: {
    input: string;
    a: string | number | (string | number)[];
    b: string | number;
    quantifier?: "all" | "any";
    where?: Condition;
  };
  sweep?: { input: string };
  pos: Pos;
}

export interface CheckDef {
  id: string;
  title: string;
  decisions?: Record<string, string | number>;
  expect?: Record<string, Json>;
  sweep?: {
    base?: string;
    input: string;
    rows: { value: string | number; expect: Record<string, Json> }[];
  };
  pos: Pos;
}

export interface RootBlock {
  currency: { label: string; short?: string };
  /** Тема экранов игры; без неё — как в системе устройства. */
  theme?: "light" | "dark";
  /** Значки в таблицах: people — у трафика и спроса, unit — у проданного и списанного. */
  icons?: { people?: string; unit?: string };
  params: JsonObject;
  /** Подписи счетов; by_phase — своя подпись в фазе. Счета с одной подписью на слайде складываются в одну строку. */
  accounts?: Record<string, { label: string; by_phase?: Record<string, string> }>;
  /** Подписи источников движения денег; by_phase — своя подпись в фазе. */
  sources?: Record<string, string | { label: string; by_phase?: Record<string, string> }>;
  conditions?: Record<string, Condition>;
  reference: string;
}

export interface Frontmatter {
  id: string;
  version: number;
  title: string;
  locale: string;
  duration_min: number;
  format: 1;
  library: 1;
  teams?: { min?: number; max?: number; recommended?: [number, number] };
  include?: string[];
}

/** Скомпилированный сценарий — канонический JSON. */
export interface Scenario {
  meta: Frontmatter;
  dir: string;
  description: string;
  root: RootBlock;
  phases: PhaseDef[];
  steps: StepDef[];
  pages: PageDef[];
  lessons: LessonDef[];
  checks: CheckDef[];
  /** "step:d13/mechanics/1/params/tiers" → место в файле. */
  sourcemap: Record<string, Pos>;
}

/** Ходы одного пути: "d2.jug" → значение. */
export type Decisions = Record<string, string | number | null>;
