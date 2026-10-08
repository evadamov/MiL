// Блоки экранов: сервер собирает, клиент только рисует.
export type Block =
  | { type: "html"; html: string; tone?: "legend" | "move" | "results" | "debrief" | "discussion" | "trainer" | "note" }
  | { type: "image"; src: string; layout: "side" | "full" | "text" }
  | { type: "table"; title?: string; head: string[]; rows: string[][]; highlight?: number[]; note?: string; compact?: boolean }
  | { type: "counter"; submitted: number; total: number; closed: boolean }
  | { type: "form"; stepId: string; open: boolean; fields: Field[] }
  | { type: "error"; message: string };

export interface Field {
  id: string;
  type: "choice" | "number" | "quiz" | "forecast";
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  value?: string;
  source?: "team" | "default" | "trainer";
}

export interface Header {
  scenario: string;
  phaseTitle: string;
  stepTitle: string;
  stepNo: number;
  steps: number;
  stage: string;
}

export interface ScreenView {
  version: number;
  header: Header;
  /** Для «вводной» с картинкой: раскладка слайда. */
  layout: "side" | "full" | "text";
  blocks: Block[];
  finished: boolean;
}

export interface TeamView {
  version: number;
  team: { id: string; name: string };
  header: Header;
  blocks: Block[];
  days: Block | null;
  reports: Block[];
  info: { id: string; title: string; html: string }[];
  finished: boolean;
}

export interface ControlTeam {
  id: string;
  name: string;
  submitted: boolean;
  values: { inputId: string; label: string; value: string; source: string; raw?: string }[];
}

export interface ControlView {
  version: number;
  code: string;
  header: Header;
  play: { step: number; phase: string };
  show: { step: number; phase: string };
  showingCurrent: boolean;
  finished: boolean;
  next: string | null;
  canReopen: boolean;
  canOverride: boolean;
  steps: { index: number; id: string; title: string; phases: { phase: string; label: string }[] }[];
  teams: ControlTeam[];
  inputs: Field[];
  notes: Block[];
  preview: ScreenView;
}

export const PHASE_LABELS: Record<string, string> = {
  legend: "вводная",
  intake: "приём ходов",
  closed: "приём закрыт",
  results: "результаты",
  debrief: "вывод",
};
