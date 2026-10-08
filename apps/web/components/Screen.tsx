"use client";
// Слайд проектора: вводная с картинкой, задание и счётчик, результаты, вывод.
import { Blocks, HeaderBar } from "./Blocks";
import type { ScreenView } from "@/lib/blocks";

export function Slide({ v, code }: { v: ScreenView; code?: string }) {
  const image = v.blocks.find((b) => b.type === "image");
  const rest = v.blocks.filter((b) => b.type !== "image");
  return (
    <>
      <HeaderBar h={v.header} right={code ? <span className="muted">Вход для команд: /join · код {code}</span> : undefined} />
      <h2>{v.header.stepTitle}</h2>
      <div className="body">
        {image && v.layout === "side" ? (
          <div className="slide-side">
            <Blocks blocks={[image]} />
            <div>
              <Blocks blocks={rest} />
            </div>
          </div>
        ) : image && v.layout === "full" ? (
          <div className="slide-full">
            <Blocks blocks={[image]} />
            <Blocks blocks={rest} />
          </div>
        ) : (
          <Blocks blocks={rest} />
        )}
      </div>
      {v.finished && <p className="badge">Воркшоп завершён</p>}
    </>
  );
}
