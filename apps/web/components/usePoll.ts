"use client";
// Опрос сервера раз в 2 секунды (docs/spec.md, п. 6). Пока вкладка скрыта — реже.
import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(url: string | null, token?: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store", headers: token ? { "x-mil-token": token } : {} });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `ошибка ${res.status}`);
      else {
        setError(null);
        setData(body as T);
      }
    } catch {
      setError("нет связи с сервером, пробую снова…");
    }
  }, [url, token]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      await load();
      if (alive) timer.current = setTimeout(tick, document.hidden ? 8000 : 2000);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { data, setData, error, reload: load };
}

export async function post<T>(url: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-mil-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `ошибка ${res.status}`);
  return data as T;
}
