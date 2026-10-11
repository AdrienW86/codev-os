// Charge un module TypeScript du dépôt dans un contexte isolé, avec des dépendances simulées.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

export function loadTs(path, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const container = { exports };
  vm.runInNewContext(code, {
    exports, module: container, console, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, setTimeout, clearTimeout, Promise, structuredClone, Intl, Date, Math, JSON,
    crypto: globalThis.crypto, performance, Buffer, process: { env: {} },
    ...globals,
    require: (name) => {
      if (name === "server-only") return {};
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (["zod", "react", "react/jsx-runtime", "node:crypto"].includes(name)) return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return container.exports;
}

/** Charge les modules purs du registre (catalogue services + registre agents). */
export function loadRegistry() {
  const services = loadTs("lib/services/catalog.ts");
  const registry = loadTs("lib/agents/registry.ts", { "@/lib/services/catalog": services });
  return { services, registry };
}
