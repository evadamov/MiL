"use client";
// Проектор: без кнопок, показывает то, что выбрано на пульте.
import { useParams } from "next/navigation";
import { Slide } from "@/components/Screen";
import { usePoll } from "@/components/usePoll";
import type { ScreenView } from "@/lib/blocks";

export default function ScreenPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { data, error } = usePoll<ScreenView>(`/api/sessions/${code}/screen`);
  return (
    <main className="screen">
      {data ? <Slide v={data} code={code} /> : <p className="muted">{error ?? "Загрузка…"}</p>}
    </main>
  );
}
