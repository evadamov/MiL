import Link from "next/link";
import { getCatalog } from "@/lib/server";
import { CreateSession } from "./CreateSession";

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

export const dynamic = "force-dynamic";

// Ведущий: каталог сценариев и создание сессии.
export default function Home() {
  const { entries } = getCatalog();
  return (
    <main className="page">
      <h1>Новый воркшоп</h1>
      <p className="muted">
        Выберите сценарий. Команды подключаются по коду на странице <Link href="/join">/join</Link>.
      </p>
      {entries.map((e) => (
        <div key={e.id} className="card">
          <div className="row">
            <div className="grow">
              <strong>{e.title}</strong>
              <div className="muted">
                {e.duration} мин · {e.steps} {plural(e.steps, "шаг", "шага", "шагов")}
                {e.teams?.recommended ? ` · рекомендуется ${e.teams.recommended[0]}–${e.teams.recommended[1]} команд` : ""}
              </div>
            </div>
            {e.ok ? <CreateSession scenarioId={e.id} /> : <span className="badge bad">сценарий с ошибками</span>}
          </div>
          {e.description && <p>{e.description.split("\n\n")[0]}</p>}
          {!e.ok && (
            <pre className="note" style={{ whiteSpace: "pre-wrap" }}>
              {e.errors.slice(0, 5).join("\n")}
            </pre>
          )}
        </div>
      ))}
      {!entries.length && <p>В каталоге scenarios/ нет сценариев.</p>}
    </main>
  );
}
