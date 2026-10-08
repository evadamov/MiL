import { handle } from "@/lib/api";
import { createSession } from "@/lib/server";
import { SessionError } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const { scenarioId } = (await req.json()) as { scenarioId?: string };
    if (!scenarioId) throw new SessionError("не выбран сценарий");
    const doc = await createSession(scenarioId);
    return { code: doc.code, trainerToken: doc.trainerToken };
  });
}
