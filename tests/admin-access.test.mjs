import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const testAdmin = "test-admin";

function loadModule(path, mocks, env = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, process: { env },
    require: (name) => name === "server-only" ? {} : mocks[name] ?? require(name),
  });
  return exports;
}

function setup(userId, adminId = testAdmin) {
  const env = { AUTHORIZED_ADMIN_USER_ID: adminId };
  const policy = loadModule("lib/admin-policy.ts", {}, env);
  const authentication = async () => ({ userId, isAuthenticated: Boolean(userId) });
  const navigation = {
    redirect: (path) => { throw new Error(`redirect:${path}`); },
    notFound: () => { throw new Error("access-denied"); },
  };
  const guard = loadModule("lib/require-admin.ts", {
    "@clerk/nextjs/server": { auth: authentication }, "next/navigation": navigation,
    "@/lib/admin-policy": policy,
  }, env);
  const proxy = loadModule("proxy.ts", {
    "@clerk/nextjs/server": { clerkMiddleware: (callback) => (request) => callback(authentication, request) },
    "@/lib/admin-policy": policy,
  }, env);
  return { ...guard, proxy: proxy.default, config: proxy.config };
}

function request(path, method = "GET") {
  return { nextUrl: new URL(`https://example.test${path}`), url: `https://example.test${path}`, method };
}

const routes = ["/", "/dashboard", "/clients", "/clients/atelier", "/clients/example.css", "/projects", "/tasks", "/agents", "/recommendations", "/settings", "/future-private-route"];

test("anonymous requests redirect to local sign-in; direct mutations stop", async () => {
  const { proxy, requireAdmin } = setup(null);
  for (const path of routes) {
    const response = await proxy(request(path));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")).pathname, "/sign-in");
  }
  assert.equal((await proxy(request("/tasks", "POST"))).status, 401);
  assert.equal((await proxy(request("/api/private"))).status, 401);
  await assert.rejects(requireAdmin, /redirect:\/sign-in/);
});

test("valid Clerk session belonging to another user never reaches cockpit", async () => {
  const { proxy, requireAdmin } = setup("test-other-user");
  for (const path of routes) assert.equal((await proxy(request(path))).status, 403);
  assert.equal((await proxy(request("/tasks", "POST"))).status, 403);
  assert.equal((await proxy(request("/api/private", "POST"))).status, 403);
  await assert.rejects(requireAdmin, /access-denied/);
});

test("authorized admin passes both server gates", async () => {
  const { proxy, requireAdmin } = setup(testAdmin);
  for (const path of routes) assert.equal(await proxy(request(path)), undefined);
  assert.equal((await requireAdmin()).userId, testAdmin);
});

test("missing, empty or whitespace admin configuration fails closed", async () => {
  for (const adminId of [undefined, "", "   "]) {
    const { proxy, requireAdmin } = setup(testAdmin, adminId === undefined ? null : adminId);
    assert.equal((await proxy(request("/dashboard"))).status, 403);
    await assert.rejects(requireAdmin, /access-denied/);
  }
});

test("sign-in stays public and sign-up always redirects without rendering", async () => {
  for (const userId of [null, "test-other-user", testAdmin]) {
    const { proxy } = setup(userId);
    assert.equal(await proxy(request("/sign-in")), undefined);
    assert.equal(await proxy(request("/sign-in/factor-one")), undefined);
    for (const path of ["/sign-up", "/sign-up/verify-email-address"]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 303);
      assert.equal(new URL(response.headers.get("location")).pathname, "/sign-in");
    }
  }
});

test("only the scheduler tick bypasses the session gate; neighbours stay protected", async () => {
  const { proxy } = setup(null);
  assert.equal(await proxy(request("/api/internal/scheduler/tick")), undefined, "tick authenticates itself with CRON_SECRET");
  assert.equal(await proxy(request("/api/internal/scheduler/tick", "POST")), undefined);
  for (const path of ["/api/internal/scheduler/tick/extra", "/api/internal/scheduler", "/api/internal/scheduler/tickx", "/api/assistant"]) {
    assert.equal((await proxy(request(path, "POST"))).status, 401, path);
  }
});

test("only exact public PWA files bypass auth on read; private neighbours and writes stay protected", async () => {
  const { proxy } = setup(null);
  for (const path of ["/sw.js", "/offline.html", "/manifest.webmanifest", "/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/apple-touch-icon.png"]) {
    assert.equal(await proxy(request(path)), undefined); assert.equal(await proxy(request(path, "HEAD")), undefined);
    assert.equal((await proxy(request(path, "POST"))).status, 401);
    assert.equal((await proxy(request(`${path}/private`))).status, 307);
  }
  const response = await proxy(request("/notifications?focus=11111111-1111-4111-8111-111111111111"));
  assert.equal(new URL(response.headers.get("location")).searchParams.get("redirect_url"), "/notifications?focus=11111111-1111-4111-8111-111111111111");
});

test("actual Next.js matcher covers private paths even with file extensions", () => {
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");
  const { config } = setup(null);
  for (const url of [...routes, "/clients/example.svg", "/sign-up", "/__clerk/v1/client", "/api/private"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true);
  }
  for (const url of ["/_next/static/chunk.js", "/_next/image?url=x", "/favicon.ico"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false);
  }
});
