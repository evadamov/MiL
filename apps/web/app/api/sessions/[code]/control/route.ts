import { Forbidden, handle } from "@/lib/api";
import { getStore } from "@/lib/server";
import { advance, override, reopen, SessionError, show, showCurrent, type Phase, type SessionDoc } from "@/lib/session";
import { NotFound } from "@/lib/store";
import { controlView } from "@/lib/views";

function auth(doc: SessionDoc | null, req: Request): SessionDoc {
  if (!doc) throw new NotFound();
  if (req.headers.get("x-mil-token") !== doc.trainerToken) throw new Forbidden("это пульт ведущего: нужен ключ из ссылки ведущего");
  return doc;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    return controlView(auth(await getStore().get(code.toUpperCase()), req));
  });
}

type Action =
  | { action: "advance" }
  | { action: "reopen" }
  | { action: "show"; step: number; phase: Phase }
  | { action: "showCurrent" }
  | { action: "override"; teamId: string; inputId: string; value: unknown };

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    const body = (await req.json()) as Action;
    const store = getStore();
    auth(await store.get(code.toUpperCase()), req);
    const now = new Date().toISOString();
    const { doc } = await store.update(code.toUpperCase(), (d) => {
      switch (body.action) {
        case "advance":
          return advance(d, now);
        case "reopen":
          return reopen(d);
        case "show":
          return show(d, body.step, body.phase);
        case "showCurrent":
          return showCurrent(d);
        case "override":
          return override(d, body.teamId, body.inputId, body.value, now);
        default:
          throw new SessionError("неизвестное действие");
      }
    });
    return controlView(doc);
  });
}
