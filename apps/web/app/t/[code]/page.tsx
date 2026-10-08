"use client";
// Экран команды: вводная, ход, свои результаты; «Мои дни», «Отчёты», «Справка».
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Blocks, HeaderBar, TableBlock } from "@/components/Blocks";
import { post, usePoll } from "@/components/usePoll";
import type { Block, Field, TeamView } from "@/lib/blocks";

type Tab = "now" | "days" | "reports" | "info";

export default function TeamPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const key = `mil:team:${code}`;
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(localStorage.getItem(key));
    setReady(true);
  }, [key]);
  if (!ready) return null;
  if (!token) return <JoinTeam code={code} onJoined={(t) => (localStorage.setItem(key, t), setToken(t))} />;
  return <TeamScreen code={code} token={token} onLost={() => (localStorage.removeItem(key), setToken(null))} />;
}

function JoinTeam({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="page">
      <h1>Сессия {code}</h1>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await post<{ token: string }>(`/api/sessions/${code}/teams`, { name });
            onJoined(r.token);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="muted">Название команды</label>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
          <button className="btn primary">Войти</button>
        </div>
        {error && <p className="badge bad">{error}</p>}
      </form>
    </main>
  );
}

function TeamScreen({ code, token, onLost }: { code: string; token: string; onLost: () => void }) {
  const { data, setData, error } = usePoll<TeamView>(`/api/sessions/${code}/team`, token);
  const [tab, setTab] = useState<Tab>("now");
  useEffect(() => {
    if (error?.startsWith("команда не найдена")) onLost();
  }, [error, onLost]);
  if (!data) return <main className="page">{error ? <p className="badge bad">{error}</p> : <p className="muted">Загрузка…</p>}</main>;
  return (
    <main className="page">
      <HeaderBar h={data.header} right={<span className="badge">{data.team.name}</span>} />
      {error && <p className="badge warn">{error}</p>}
      <div className="tabs">
        {(
          [
            ["now", "Сейчас"],
            ["days", "Мои дни"],
            ["reports", "Отчёты"],
            ["info", "Справка"],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "now" && (
        <>
          <h2 style={{ margin: "4px 0 8px" }}>{data.header.stepTitle}</h2>
          {data.finished && <p className="badge">Воркшоп завершён</p>}
          <Blocks
            blocks={data.blocks}
            render={(b, i) => (b.type === "form" ? <MoveForm key={i} code={code} token={token} form={b} onSaved={setData} /> : undefined)}
          />
        </>
      )}
      {tab === "days" && (data.days ? <TableBlock b={data.days as Extract<Block, { type: "table" }>} /> : <p className="muted">Пока ни одного дня.</p>)}
      {tab === "reports" && (data.reports.length ? <Blocks blocks={data.reports} /> : <p className="muted">Отчёты появятся после итогов фазы.</p>)}
      {tab === "info" &&
        (data.info.length ? (
          data.info.map((p) => (
            <div key={p.id} className="card html">
              <p className="table-title">{p.title}</p>
              <div dangerouslySetInnerHTML={{ __html: p.html }} />
            </div>
          ))
        ) : (
          <p className="muted">Справки пока нет.</p>
        ))}
    </main>
  );
}

const BUTTON: Record<Field["type"], string> = { choice: "Выбрать", number: "Отправить", quiz: "Посчитать", forecast: "Дать прогноз" };

function MoveForm({ code, token, form, onSaved }: { code: string; token: string; form: Extract<Block, { type: "form" }>; onSaved: (v: TeamView) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((f) => [f.id, f.value ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const sent = form.fields.some((f) => f.source === "team");
  // Новые значения с сервера (после отправки или правки ведущего) — в поля, если пользователь их не трогает.
  const serverKey = form.fields.map((f) => `${f.id}=${f.value ?? ""}`).join("&");
  useEffect(() => {
    setValues(Object.fromEntries(form.fields.map((f) => [f.id, f.value ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  const verb = form.fields.length === 1 ? BUTTON[form.fields[0].type] : "Отправить ход";
  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          onSaved(await post<TeamView>(`/api/sessions/${code}/team`, { stepId: form.stepId, values }, token));
          setSaved(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      {form.fields.map((f) => (
        <div key={f.id}>
          <label>
            {f.label}
            {f.source === "default" && <span className="badge warn"> по умолчанию</span>}
            {f.source === "trainer" && <span className="badge warn"> изменил ведущий</span>}
          </label>
          {f.type === "choice" ? (
            <div className="options">
              {f.options!.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  disabled={!form.open}
                  className={`option ${values[f.id] === o.value ? "on" : ""}`}
                  onClick={() => (setValues({ ...values, [f.id]: o.value }), setSaved(false))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="row">
            <input
              className="input grow"
              inputMode="decimal"
              disabled={!form.open}
              value={values[f.id] ?? ""}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(e) => (setValues({ ...values, [f.id]: e.target.value }), setSaved(false))}
            />
            {f.unit && <span className="muted">{f.unit}</span>}
            </div>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 14 }}>
        {form.open ? (
          <button className="btn primary">{sent ? "Изменить ход" : verb}</button>
        ) : (
          <span className="badge warn">Приём закрыт</span>
        )}
        {form.open && sent && <span className="muted">{saved ? "Сохранено." : "Ход отправлен — можно изменить до закрытия приёма."}</span>}
        {error && <span className="badge bad">{error}</span>}
      </div>
    </form>
  );
}
