// Общие обёртки route handlers: ошибки → JSON с понятным сообщением.
import { NextResponse } from "next/server";
import { SessionError } from "./session";
import { NotFound } from "./store";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof SessionError) return json({ error: e.message }, e.status);
    if (e instanceof NotFound) return json({ error: e.message }, 404);
    if (e instanceof Forbidden) return json({ error: e.message }, 403);
    console.error(e);
    return json({ error: "внутренняя ошибка сервера" }, 500);
  }
}

export class Forbidden extends Error {
  constructor(m = "нет доступа") {
    super(m);
  }
}
