import crypto from "node:crypto";
import { handle } from "@/lib/api";
import { getStore, token } from "@/lib/server";
import { addTeam } from "@/lib/session";

// Вход команды по коду: название без регистрации, в ответ — токен команды.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    const { name } = (await req.json()) as { name?: string };
    const { result } = await getStore().update(code.toUpperCase(), (d) =>
      addTeam(d, String(name ?? ""), crypto.randomUUID(), token(), new Date().toISOString()),
    );
    return { teamId: result.id, token: result.token, name: result.name };
  });
}
