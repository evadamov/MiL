import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Движок подключается исходниками TypeScript из packages/engine.
  transpilePackages: ["@mil/engine"],
  serverExternalPackages: [],
  turbopack: { root: path.join(import.meta.dirname, "../..") },
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // В разработке: телефоны команд в той же сети открывают dev-сервер по IP.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default config;
