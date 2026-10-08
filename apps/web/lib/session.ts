// Логика сессии воркшопа (docs/spec.md, п. 3, 6): фазы шага, два указателя —
// шаг игры и показ на проекторе, приём ходов, значения по умолчанию.
// Чистые функции над документом сессии; хранение — в store.ts.
import { InputValueError, isModelInput, normalizeInput, type Decisions, type InputDef, type Scenario, type StepDef } from "@mil/engine";

export type Phase = "legend" | "intake" | "closed" | "results" | "debrief";
export type MoveSource = "team" | "default" | "trainer";

export interface Move {
  value: string | number;
  at: string;
  source: MoveSource;
}

export interface Team {
  id: string;
  name: string;
  token: string;
  joinedAt: string;
}

export interface Pointer {
  step: number;
  phase: Phase;
}

export interface SessionDoc {
  code: string;
  version: number;
  createdAt: string;
  trainerToken: string;
  scenario: Scenario;
  /** Картинки вводных: шаг → имя файла в хранилище картинок (по хешу содержимого). */
  images: Record<string, string>;
  play: Pointer;
  show: Pointer;
  finished: boolean;
  teams: Team[];
  /** teamId → stepId → inputId → ход. Нет записи — нет ответа. */
  moves: Record<string, Record<string, Record<string, Move>>>;
}

export class SessionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function stepAt(doc: SessionDoc, i: number): StepDef {
  return doc.scenario.steps[i];
}

export function hasResults(step: StepDef): boolean {
  return !!(step.block.inputs?.length || step.block.mechanics?.length || step.block.type === "summary");
}

export function hasDebrief(step: StepDef): boolean {
  return step.slots.some((s) => s.name === "debrief" || s.name === "discussion");
}

/** Фазы шага в порядке прохождения. */
export function phasesOf(step: StepDef): Phase[] {
  const p: Phase[] = ["legend"];
  if (step.block.inputs?.length) p.push("intake", "closed");
  if (hasResults(step)) p.push("results");
  if (hasDebrief(step)) p.push("debrief");
  return p;
}

const order = (step: StepDef, phase: Phase) => phasesOf(step).indexOf(phase);

/** Ходы шага закрыты: команды больше не меняют их, результаты можно считать. */
export function isClosed(doc: SessionDoc, i: number): boolean {
  if (i < doc.play.step) return true;
  if (i > doc.play.step) return false;
  const step = stepAt(doc, i);
  return !step.block.inputs?.length || order(step, doc.play.phase) >= order(step, "closed");
}

/** Результаты шага раскрыты. */
export function isRevealed(doc: SessionDoc, i: number): boolean {
  if (i < doc.play.step) return true;
  if (i > doc.play.step) return false;
  const step = stepAt(doc, i);
  return hasResults(step) && order(step, doc.play.phase) >= order(step, "results");
}

/** Ходы команды для движка: только закрытые шаги; квиз без ответа — null. */
export function decisionsOf(doc: SessionDoc, teamId: string): Decisions {
  const d: Decisions = {};
  doc.scenario.steps.forEach((step, i) => {
    if (!isClosed(doc, i)) return;
    for (const inp of step.block.inputs ?? []) {
      const m = doc.moves[teamId]?.[step.id]?.[inp.id];
      if (m) d[`${step.id}.${inp.id}`] = m.value;
    }
  });
  return d;
}

/** Проверка хода — та же функция, что в движке: одно правило для API, формы и runPath. */
export function checkValue(inp: InputDef, raw: unknown): string | number {
  try {
    return normalizeInput(inp, raw);
  } catch (e) {
    if (e instanceof InputValueError) throw new SessionError(`${inp.label}: ${e.message}`);
    throw e;
  }
}

// ---------- действия команды ----------

export function addTeam(doc: SessionDoc, name: string, id: string, token: string, now: string): Team {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) throw new SessionError("введите название команды");
  if (doc.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw new SessionError("команда с таким названием уже есть");
  if (doc.finished) throw new SessionError("воркшоп завершён");
  const max = doc.scenario.meta.teams?.max;
  if (max && doc.teams.length >= max) throw new SessionError(`в сессии уже ${max} команд — это максимум сценария`);
  const team = { id, name: clean, token, joinedAt: now };
  doc.teams.push(team);
  return team;
}

export function submitMove(doc: SessionDoc, teamId: string, stepId: string, values: Record<string, unknown>, now: string): void {
  const step = stepAt(doc, doc.play.step);
  if (step.id !== stepId || doc.play.phase !== "intake") throw new SessionError("приём ходов закрыт", 409);
  const inputs = step.block.inputs ?? [];
  const moves = ((doc.moves[teamId] ??= {})[stepId] ??= {});
  for (const [id, raw] of Object.entries(values)) {
    const inp = inputs.find((x) => x.id === id);
    if (!inp) throw new SessionError(`нет поля ${id}`);
    if (raw === "" || raw === null || raw === undefined) continue;
    moves[id] = { value: checkValue(inp, raw), at: now, source: "team" };
  }
}

// ---------- действия ведущего ----------

/** Следующая фаза шага игры; после последней — следующий шаг. Показ идёт следом. */
export function advance(doc: SessionDoc, now: string): void {
  if (doc.finished) throw new SessionError("воркшоп завершён");
  const step = stepAt(doc, doc.play.step);
  const phases = phasesOf(step);
  const k = phases.indexOf(doc.play.phase);
  if (k < phases.length - 1) {
    const next = phases[k + 1];
    if (next === "closed") fillDefaults(doc, step, now);
    doc.play = { step: doc.play.step, phase: next };
  } else if (doc.play.step < doc.scenario.steps.length - 1) doc.play = { step: doc.play.step + 1, phase: "legend" };
  else doc.finished = true;
  doc.show = { ...doc.play };
}

/** «Продлить приём»: из «приём закрыт» обратно в приём; подставленные значения снимаются. */
export function reopen(doc: SessionDoc): void {
  const step = stepAt(doc, doc.play.step);
  if (doc.play.phase !== "closed") throw new SessionError("продлить можно только закрытый приём");
  for (const team of doc.teams) {
    const m = doc.moves[team.id]?.[step.id];
    if (!m) continue;
    for (const [id, mv] of Object.entries(m)) if (mv.source === "default") delete m[id];
  }
  doc.play = { step: doc.play.step, phase: "intake" };
  doc.show = { ...doc.play };
}

/** Команда без хода получает default для решений; квизы и прогнозы остаются без ответа. */
function fillDefaults(doc: SessionDoc, step: StepDef, now: string): void {
  for (const team of doc.teams) {
    const m = ((doc.moves[team.id] ??= {})[step.id] ??= {});
    for (const inp of step.block.inputs ?? [])
      if (isModelInput(inp) && !m[inp.id] && inp.default !== undefined) m[inp.id] = { value: inp.default, at: now, source: "default" };
  }
}

/** Ведущий меняет ход команды — пока результаты шага не раскрыты. */
export function override(doc: SessionDoc, teamId: string, inputId: string, raw: unknown, now: string): void {
  const step = stepAt(doc, doc.play.step);
  if (doc.play.phase !== "intake" && doc.play.phase !== "closed") throw new SessionError("менять ход можно до раскрытия результатов", 409);
  if (!doc.teams.some((t) => t.id === teamId)) throw new SessionError("нет такой команды");
  const inp = step.block.inputs?.find((x) => x.id === inputId);
  if (!inp) throw new SessionError(`нет поля ${inputId}`);
  ((doc.moves[teamId] ??= {})[step.id] ??= {})[inputId] = { value: checkValue(inp, raw), at: now, source: "trainer" };
}

/** Показ на проекторе: любой слайд не дальше шага и фазы игры. */
export function show(doc: SessionDoc, stepIndex: number, phase: Phase): void {
  const step = doc.scenario.steps[stepIndex];
  if (!step) throw new SessionError("нет такого шага");
  const phases = phasesOf(step);
  if (!phases.includes(phase)) throw new SessionError("у шага нет такой фазы");
  if (stepIndex > doc.play.step) throw new SessionError("нельзя показать шаг, до которого игра ещё не дошла");
  if (stepIndex === doc.play.step && phases.indexOf(phase) > phases.indexOf(doc.play.phase))
    throw new SessionError("эта фаза текущего шага ещё не наступила");
  doc.show = { step: stepIndex, phase };
}

export function showCurrent(doc: SessionDoc): void {
  doc.show = { ...doc.play };
}

/** Фазы, доступные для показа у шага i. */
export function showablePhases(doc: SessionDoc, i: number): Phase[] {
  const phases = phasesOf(stepAt(doc, i));
  if (i < doc.play.step) return phases;
  if (i > doc.play.step) return [];
  return phases.slice(0, phases.indexOf(doc.play.phase) + 1);
}

export function newSession(code: string, trainerToken: string, scenario: Scenario, images: Record<string, string>, now: string): SessionDoc {
  return {
    code,
    version: 0,
    createdAt: now,
    trainerToken,
    scenario,
    images,
    play: { step: 0, phase: "legend" },
    show: { step: 0, phase: "legend" },
    finished: false,
    teams: [],
    moves: {},
  };
}
