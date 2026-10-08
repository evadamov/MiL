"use client";
// Отрисовка блоков, собранных сервером. Логики здесь нет — только вид.
import type { Block, Header } from "@/lib/blocks";

export function HeaderBar({ h, right }: { h: Header; right?: React.ReactNode }) {
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
    <div className="card">
      {b.title && <p className="table-title">{b.title}</p>}
      <div className="table-wrap">
        <table>
          {b.head.some(Boolean) && (
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className={b.highlight?.includes(i) ? "hl" : undefined}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
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
