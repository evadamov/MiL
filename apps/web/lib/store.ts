// Хранилище сессий: «прочитать» и «атомарно изменить» (docs/spec.md, п. 6).
// Первая реализация — JSON-файл на сессию. Записи в одну сессию идут по очереди
// внутри процесса; файл заменяется через временный файл и переименование.
// Ограничение: один процесс Node. Redis-реализация — тот же интерфейс.
import fs from "node:fs/promises";
import path from "node:path";
import type { SessionDoc } from "./session";

export interface SessionStore {
  get(code: string): Promise<SessionDoc | null>;
  /** fn получает копию документа; её результат сохраняется целиком. */
  update<T>(code: string, fn: (doc: SessionDoc) => T): Promise<{ doc: SessionDoc; result: T }>;
  create(doc: SessionDoc): Promise<void>;
  exists(code: string): Promise<boolean>;
}

const CODE = /^[A-Z0-9]{4,8}$/;

export class FileStore implements SessionStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private dir: string) {}

  private file(code: string): string {
    if (!CODE.test(code)) throw new Error("неверный код сессии");
    return path.join(this.dir, `${code}.json`);
  }

  /** Очередь на сессию: следующая операция начинается после предыдущей. */
  private serial<T>(code: string, op: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(code) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.queues.set(
      code,
      next.catch(() => undefined),
    );
    return next;
  }

  async exists(code: string): Promise<boolean> {
    try {
      await fs.access(this.file(code));
      return true;
    } catch {
      return false;
    }
  }

  async get(code: string): Promise<SessionDoc | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(code), "utf8")) as SessionDoc;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  private async write(doc: SessionDoc): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(doc.code);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc));
    await fs.rename(tmp, target);
  }

  create(doc: SessionDoc): Promise<void> {
    return this.serial(doc.code, async () => {
      if (await this.exists(doc.code)) throw new Error("сессия с таким кодом уже есть");
      await this.write(doc);
    });
  }

  update<T>(code: string, fn: (doc: SessionDoc) => T): Promise<{ doc: SessionDoc; result: T }> {
    return this.serial(code, async () => {
      const doc = await this.get(code);
      if (!doc) throw new NotFound();
      const copy = structuredClone(doc);
      const result = fn(copy);
      copy.version = doc.version + 1;
      await this.write(copy);
      return { doc: copy, result };
    });
  }
}

export class NotFound extends Error {
  constructor() {
    super("сессия не найдена");
  }
}
