"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Вход команды: только код сессии; название — на следующем экране.
export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <main className="page">
      <h1>Вход для команды</h1>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/t/${code.trim().toUpperCase()}`);
        }}
      >
        <label className="muted">Код сессии с экрана ведущего</label>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input grow" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoCapitalize="characters" placeholder="например, K7Q2M" />
          <button className="btn primary">Войти</button>
        </div>
      </form>
    </main>
  );
}
