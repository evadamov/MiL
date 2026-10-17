"use client";
// Проектор: без кнопок, показывает то, что выбрано на пульте.
import { useParams } from "next/navigation";
import { useRef } from "react";
import { Slide } from "@/components/Screen";
import { useFitHeight } from "@/components/useFitHeight";
import { usePoll } from "@/components/usePoll";
import type { ScreenView } from "@/lib/blocks";

export default function ScreenPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { data, error } = usePoll<ScreenView>(`/api/sessions/${code}/screen`);
  const ref = useRef<HTMLElement>(null);
  useFitHeight(ref, data ? JSON.stringify(data) : null);
  return (
    <main className="screen" ref={ref}>
      {data ? <Slide v={data} code={code} /> : <p className="muted">{error ?? "Загрузка…"}</p>}
    </main>
  );
}
