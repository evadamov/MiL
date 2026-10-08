"use client";
// Пульт ведущего: шаг игры и показ на проекторе — два независимых указателя.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Blocks, HeaderBar } from "@/components/Blocks";
import { Slide } from "@/components/Screen";
import { post, usePoll } from "@/components/usePoll";
import type { ControlTeam, ControlView, Field } from "@/lib/blocks";

export default function ControlPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const key = `mil:trainer:${code}`;
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("k");
    if (fromHash) localStorage.setItem(key, fromHash);
    setToken(fromHash ?? localStorage.getItem(key));
    setReady(true);
  }, [code]);
  if (!ready) return null;
  if (!token) return <main className="page">Нужна ссылка ведущего с ключом (#k=…), открытая при создании сессии.</main>;
  return <Control code={code} token={token} />;
}

function Control({ code, token }: { code: string; token: string }) {
  const { data, setData, error } = usePoll<ControlView>(`/api/sessions/${code}/control`, token);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const act = async (body: object) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await post<ControlView>(`/api/sessions/${code}/control`, body, token));
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <main className="page">{error ?? "Загрузка…"}</main>;
  const origin = typeof location !== "undefined" ? location.origin : "";
  const submitted = data.teams.filter((t) => t.submitted).length;
  return (
    <main className="page wide">
      <HeaderBar
        h={data.header}
        right={
          <div className="row">
            <span>
              Код для команд: <strong style={{ fontSize: "1.3em", letterSpacing: "0.1em" }}>{data.code}</strong> · {origin}/join
            </span>
            <a className="btn small" href={`/s/${code}/screen`} target="_blank" rel="noreferrer">
              Открыть проектор
            </a>
          </div>
        }
      />
      {!data.showingCurrent && (
        <div className="notice">
          <span>
            На проекторе: {data.steps[data.show.step]?.title} · {data.steps[data.show.step]?.phases.find((p) => p.phase === data.show.phase)?.label}
          </span>
          <button className="btn small" disabled={busy} onClick={() => act({ action: "showCurrent" })}>
            Вернуться к текущему
          </button>
        </div>
      )}
      {(error || actionError) && <p className="badge bad">{actionError ?? error}</p>}
      <div className="control">
        <section>
          <h2 style={{ margin: "4px 0" }}>{data.header.stepTitle}</h2>
          <div className="row" style={{ margin: "10px 0" }}>
            {data.next && (
              <button className="btn primary" disabled={busy} onClick={() => act({ action: "advance" })}>
                {data.next}
              </button>
            )}
            {data.canReopen && (
              <button className="btn" disabled={busy} onClick={() => act({ action: "reopen" })}>
                Продлить приём
              </button>
            )}
            {data.finished && <span className="badge">Воркшоп завершён</span>}
          </div>
          <Blocks blocks={data.notes} />
          <div className="card">
            <p className="table-title">
              Команды · {data.teams.length}
              {data.inputs.length && data.play.phase !== "legend" ? ` · отправили ${submitted}` : ""}
            </p>
            {!data.teams.length && <p className="muted">Пока никто не вошёл. Команды открывают {origin}/join и вводят код.</p>}
            <table>
              <tbody>
                {data.teams.map((t) => (
                  <TeamRow key={t.id} t={t} phase={data.play.phase} inputs={data.inputs} canOverride={data.canOverride} onOverride={(inputId, value) => act({ action: "override", teamId: t.id, inputId, value })} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="card steps">
            <p className="table-title">Показать на проекторе</p>
            {data.steps.map((s) => (
              <div key={s.id} className="step">
                <span style={{ minWidth: 180 }}>{s.title}</span>
                {s.phases.map((p) => (
                  <button
                    key={p.phase}
                    className={`btn small ${data.show.step === s.index && data.show.phase === p.phase ? "primary" : ""}`}
                    disabled={busy}
                    onClick={() => act({ action: "show", step: s.index, phase: p.phase })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="muted">
            <Link href="/">← каталог сценариев</Link>
          </p>
        </section>
        <section>
          <p className="table-title">Сейчас на проекторе</p>
          <div className="preview">
            <Slide v={data.preview} />
          </div>
        </section>
      </div>
    </main>
  );
}

function TeamRow({ t, phase, inputs, canOverride, onOverride }: { t: ControlTeam; phase: string; inputs: Field[]; canOverride: boolean; onOverride: (inputId: string, value: string) => void }) {
  const status = !inputs.length || phase === "legend" ? null : t.submitted ? <span className="badge">отправила</span> : phase === "intake" ? <span className="badge warn">ждём</span> : <span className="badge bad">не отправила</span>;
  return (
    <tr>
      <td>
        {t.name} {status}
      </td>
      {t.values.map((v) => {
        const inp = inputs.find((i) => i.id === v.inputId)!;
        return (
          <td key={v.inputId}>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              {v.label}
            </div>
            {canOverride && inp.type === "choice" ? (
              <select className="input" value={v.raw ?? ""} onChange={(e) => onOverride(v.inputId, e.target.value)}>
                <option value="" disabled>
                  —
                </option>
                {inp.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : canOverride && inp.type === "number" ? (
              <input
                className="input"
                defaultValue={v.raw ?? ""}
                key={v.raw}
                onBlur={(e) => e.target.value && e.target.value !== v.raw && onOverride(v.inputId, e.target.value)}
              />
            ) : (
              <span>{v.value}</span>
            )}
            {v.source === "default" && <span className="badge warn"> по умолчанию</span>}
            {v.source === "trainer" && <span className="badge warn"> ведущий</span>}
          </td>
        );
      })}
    </tr>
  );
}
