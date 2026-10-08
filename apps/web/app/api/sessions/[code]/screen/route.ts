import { handle } from "@/lib/api";
import { getStore } from "@/lib/server";
import { NotFound } from "@/lib/store";
import { screenView } from "@/lib/views";

// Проектор: только то, что видит зал; без ходов команд и токенов.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await params;
    const doc = await getStore().get(code.toUpperCase());
    if (!doc) throw new NotFound();
    return screenView(doc);
  });
}
