import { readImage } from "@/lib/server";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const img = readImage((await params).name);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.body), { headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable" } });
}
