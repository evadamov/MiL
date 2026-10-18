"use client";
// Отрисовка блоков, собранных сервером. Логики здесь нет — только вид.
import { useEffect } from "react";
import type { Block, Header } from "@/lib/blocks";

export function HeaderBar({ h, right }: { h: Header; right?: React.ReactNode }) {
  // Тема сценария — на весь документ: проектор, пульт и экран команды выглядят одинаково.
  useEffect(() => {
    if (h.theme) document.documentElement.dataset.theme = h.theme;
    else delete document.documentElement.dataset.theme;
  }, [h.theme]);
  return (
    <div className="header">
      <div>
        <div className="muted">
          {h.scenario} · {h.phaseTitle}
        </div>
        <div className="stage">
          Шаг {h.stepNo} из {h.steps} · {h.stage}
        </div>
      </div>
      {right}
    </div>
  );
}

export function TableBlock({ b }: { b: Extract<Block, { type: "table" }> }) {
  return (
    <div className={["card", b.wide && "wide", b.text && "text-table"].filter(Boolean).join(" ")}>
      {b.title && <p className="table-title">{b.title}</p>}
      <div className="table-wrap">
        <table>
          {b.head.some(Boolean) && (
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} className={b.center?.includes(i) ? "center" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className={b.highlight?.includes(i) ? "hl" : undefined}>
                {r.map((c, j) => (
                  <td key={j} className={b.center?.includes(j) ? "center" : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {b.note && <p className="note" dangerouslySetInnerHTML={{ __html: b.note }} />}
    </div>
  );
}

export function Blocks({ blocks, render }: { blocks: Block[]; render?: (b: Block, i: number) => React.ReactNode | undefined }) {
  return (
    <>
      {blocks.map((b, i) => {
        const custom = render?.(b, i);
        if (custom !== undefined) return custom;
        switch (b.type) {
          case "html":
            return <div key={i} className={`card html tone-${b.tone ?? "legend"}`} dangerouslySetInnerHTML={{ __html: b.html }} />;
          case "image":
            return <img key={i} className="slide-img" src={b.src} alt="" />;
          case "table":
            return <TableBlock key={i} b={b} />;
          case "counter":
            return (
              <div key={i} className="card counter">
                {b.closed ? "Приём закрыт · " : "Отправили "}
                {b.submitted} из {b.total}
              </div>
            );
          case "choice":
            return (
              <div key={i} className="card choice">
                <p className="table-title">{b.title}</p>
                {b.options.map((o) => (
                  <div key={o.label} className="choice-row">
                    <span className="choice-label">
                      {o.label} <span className="muted">· {o.teams.length}</span>
                    </span>
                    <span className="chips">
                      {o.teams.map((t) => (
                        <span key={t} className="chip on">
                          {t}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            );
          case "answered": {
            const ready = b.teams.filter((t) => t.done >= t.total).length;
            return (
              <div key={i} className="card answered">
                {b.questions.map((q, k) => (
                  <p key={k} className="question">
                    {q}
                  </p>
                ))}
                <div className="chips">
                  {b.teams.map((t) => (
                    <span key={t.name} className={t.done >= t.total ? "chip on" : "chip"}>
                      {t.done >= t.total ? "✓" : "…"} {t.name}
                      {t.total > 1 && t.done < t.total ? ` ${t.done}/${t.total}` : ""}
                    </span>
                  ))}
                </div>
                <p className="muted">
                  {b.closed ? "Приём закрыт · " : ""}Ответили {ready} из {b.teams.length}
                </p>
              </div>
            );
          }
          case "error":
            return (
              <div key={i} className="card error">
                {b.message}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
