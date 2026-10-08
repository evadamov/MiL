"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "@/components/usePoll";

export function CreateSession({ scenarioId }: { scenarioId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { code, trainerToken } = await post<{ code: string; trainerToken: string }>("/api/sessions", { scenarioId });
            localStorage.setItem(`mil:trainer:${code}`, trainerToken);
            // Ключ ведущего — во фрагменте адреса: он не уходит на сервер в логи запросов.
            router.push(`/s/${code}/control#k=${trainerToken}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Создать сессию
      </button>
      {error && <div className="badge bad">{error}</div>}
    </div>
  );
}
