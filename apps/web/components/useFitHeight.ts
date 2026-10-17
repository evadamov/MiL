"use client";
// Слайд проектора целиком помещается по высоте экрана: если содержимое выше,
// шрифт слайда уменьшается (не ниже MIN). Размер проектора заранее неизвестен.
import { type RefObject, useLayoutEffect } from "react";

const MIN = 0.5;

export function useFitHeight(ref: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = (s: number) => {
      el.style.setProperty("--fit", String(s));
      return el.scrollHeight <= window.innerHeight + 1;
    };
    const root = document.documentElement;
    const fit = () => {
      // Без полосы прокрутки на время замера: её появление сужает слайд и меняет переносы.
      root.style.overflowY = "hidden";
      if (fits(1)) return;
      // Двоичный поиск наибольшего масштаба, при котором слайд помещается.
      let lo = MIN, hi = 1;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      // Не поместилось и при MIN — возвращаем прокрутку, чтобы ничего не обрезать.
      if (!fits(lo)) root.style.overflowY = "";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      root.style.overflowY = "";
    };
  }, [ref, key]);
}
