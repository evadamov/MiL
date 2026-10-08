import { Forbidden, handle } from "@/lib/api";
import { getStore } from "@/lib/server";
import { submitMove, type SessionDoc } from "@/lib/session";
import { NotFound } from "@/lib/store";
import { teamView } from "@/lib/views";

function teamOf(doc: SessionDoc | null, req: Request) {
  if (!doc) throw new NotFound();
  const team = doc.teams.find((t) => t.token === req.headers.get("x-mil-token"));
  if (!team) throw new Forbidden("команда не найдена: войдите заново по коду сессии");
  return team;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    const doc = await getStore().get(code.toUpperCase());
    return teamView(doc!, teamOf(doc, req));
  });
}

// Ход команды; повторная отправка до закрытия приёма перезаписывает.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    const body = (await req.json()) as { stepId: string; values: Record<string, unknown> };
    const store = getStore();
    const team = teamOf(await store.get(code.toUpperCase()), req);
    const { doc } = await store.update(code.toUpperCase(), (d) => submitMove(d, team.id, body.stepId, body.values ?? {}, new Date().toISOString()));
    return teamView(doc, team);
  });
}
