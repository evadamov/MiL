// Серверная часть: каталог сценариев, хранилище, картинки, токены.
// Только для route handlers и серверных компонентов.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateScenario, type Scenario } from "@mil/engine";
import { newSession, type SessionDoc } from "./session";
import { FileStore, type SessionStore } from "./store";

// Приложение запускается из репозитория на своём сервере: сценарии и данные читаются
// с диска во время работы, а не упаковываются в сборку.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.MIL_ROOT ?? path.join(process.cwd(), "../.."));
const DATA = path.resolve(/*turbopackIgnore: true*/ process.env.MIL_DATA ?? path.join(ROOT, "data"));
const IMAGES = path.join(DATA, "images");

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  duration: number;
  steps: number;
  teams?: { min?: number; max?: number; recommended?: [number, number] };
  ok: boolean;
  errors: string[];
}

interface Catalog {
  entries: CatalogEntry[];
  scenarios: Map<string, Scenario>;
}

let catalog: Catalog | null = null;

/** Каталог собирается один раз при запуске процесса; сборка (prebuild) проверяет то же самое. */
export function getCatalog(): Catalog {
  if (catalog) return catalog;
  const base = path.join(ROOT, "scenarios");
  const entries: CatalogEntry[] = [];
  const scenarios = new Map<string, Scenario>();
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const dir = path.join(base, d);
    if (!fs.existsSync(path.join(dir, "scenario.md")) && !fs.existsSync(path.join(dir, "scenario.json"))) continue;
    const rep = validateScenario(dir, ROOT);
    const errors = rep.diagnostics.filter((x) => x.severity === "error").map((x) => `${x.pos?.file}:${x.pos?.line} ${x.code} ${x.message}`);
    const sc = rep.scenario;
    entries.push({
      id: sc?.meta.id ?? d,
      title: sc?.meta.title ?? d,
      description: sc?.description ?? "",
      duration: sc?.meta.duration_min ?? 0,
      steps: sc?.steps.length ?? 0,
      teams: sc?.meta.teams,
      ok: !errors.length && !!sc,
      errors,
    });
    if (sc && !errors.length) scenarios.set(sc.meta.id, sc);
  }
  catalog = { entries, scenarios };
  return catalog;
}

let store: SessionStore | null = null;
export function getStore(): SessionStore {
  return (store ??= new FileStore(path.join(DATA, "sessions")));
}

export const token = () => crypto.randomBytes(18).toString("base64url");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () => Array.from(crypto.randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join("");

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** Картинки вводных копируются в хранилище под именем по хешу: сессия видит свои версии файлов. */
function snapshotImages(sc: Scenario): Record<string, string> {
  const out: Record<string, string> = {};
  fs.mkdirSync(IMAGES, { recursive: true });
  for (const step of sc.steps) {
    const rel = step.block.legend?.image;
    if (!rel) continue;
    const src = path.join(sc.dir, rel);
    const buf = fs.readFileSync(src);
    const name = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32) + path.extname(rel).toLowerCase();
    const dst = path.join(IMAGES, name);
    if (!fs.existsSync(dst)) fs.writeFileSync(dst, buf);
    out[step.id] = name;
  }
  return out;
}

export function readImage(name: string): { body: Buffer; type: string } | null {
  if (!/^[0-9a-f]{32}\.(png|jpe?g|webp|svg)$/.test(name)) return null;
  const file = path.join(IMAGES, name);
  if (!fs.existsSync(file)) return null;
  return { body: fs.readFileSync(file), type: MIME[path.extname(name)] };
}

export async function createSession(scenarioId: string): Promise<SessionDoc> {
  const sc = getCatalog().scenarios.get(scenarioId);
  if (!sc) throw new Error("нет такого сценария или он не прошёл проверку");
  const { sourcemap: _sm, ...rest } = sc;
  const snapshot: Scenario = { ...rest, sourcemap: {} };
  const images = snapshotImages(sc);
  const s = getStore();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newCode();
    if (await s.exists(code)) continue;
    const doc = newSession(code, token(), snapshot, images, new Date().toISOString());
    await s.create(doc);
    return doc;
  }
  throw new Error("не удалось подобрать код сессии");
}
