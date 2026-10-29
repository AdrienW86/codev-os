import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs, loadRegistry } from "./helpers/load-ts.mjs";

const REPO = "company/client";
const SHA = "a".repeat(40);
const SECOND = "b".repeat(40);
const pr = (overrides = {}) => ({
  number: 4, title: "Nouvel article dératisation", html_url: "https://github.com/company/client/pull/4",
  state: "open", draft: true,
  head: { ref: "codev-dev/article-deratisation", sha: SHA, repo: { full_name: REPO } },
  base: { ref: "main" }, ...overrides,
});
const model = loadTs("lib/developer/pr-model.ts");

test("Developer PR scope refuses forks, external URLs, wrong branches, malformed SHA and repositories", () => {
  assert.equal(model.parseDeveloperPullRequest(REPO, pr())?.headSha, SHA);
  for (const invalid of [
    pr({ html_url: "https://evil.example/pull/4" }),
    pr({ head: { ref: "feature/other", sha: SHA, repo: { full_name: REPO } } }),
    pr({ head: { ref: "codev-dev/test", sha: SHA, repo: { full_name: "stranger/fork" } } }),
    pr({ head: { ref: "codev-dev/test", sha: "invalid", repo: { full_name: REPO } } }),
    pr({ base: { ref: "codev-dev/article-deratisation" } }),
  ]) assert.equal(model.parseDeveloperPullRequest(REPO, invalid), null);
  assert.equal(model.parseDeveloperPullRequest("../secrets", pr()), null);
});

test("Developer preview is only accepted for a successful Preview deployment matching the current SHA", () => {
  const preview = [{ sha: SHA, environment: "Preview", statuses: [{ state: "success", environment_url: "https://site-git-feature-company.vercel.app/article" }] }];
  assert.equal(model.verifiedPreviewUrl(preview, SHA), "https://site-git-feature-company.vercel.app/article");
  assert.equal(model.verifiedPreviewUrl(preview, SECOND), null);
  assert.equal(model.verifiedPreviewUrl([{ ...preview[0], environment: "Production" }], SHA), null);
  assert.equal(model.verifiedPreviewUrl([{ ...preview[0], statuses: [{ state: "pending", environment_url: "https://site.vercel.app" }] }], SHA), null);
  for (const url of ["http://site.vercel.app", "https://site.vercel.app.evil.com", "https://user:pass@site.vercel.app", "javascript:alert(1)"]) {
    assert.equal(model.verifiedPreviewUrl([{ ...preview[0], statuses: [{ state: "success", environment_url: url }] }], SHA), null);
  }
});

test("Checks fail closed; approval is tied to immutable commit SHA", () => {
  assert.equal(model.observedCheckState({ state: "success" }, { check_runs: [{ status: "completed", conclusion: "success" }] }), "passed");
  assert.equal(model.observedCheckState({ state: "pending" }, { check_runs: [] }), "pending");
  assert.equal(model.observedCheckState({ state: "success" }, { check_runs: [{ status: "completed", conclusion: "failure" }] }), "failed");
  assert.equal(model.observedCheckState(undefined, undefined), "unknown");
  assert.equal(model.approvalMatchesHead(SHA, SHA), true);
  assert.equal(model.approvalMatchesHead(SHA, SECOND), false);
  assert.equal(model.approvalMatchesHead(null, SHA), false);
});

test("GitHub reader only calls GET endpoints and ignores untrusted PRs", async () => {
  const paths = [];
  const api = async (_provider, url, opts = {}) => {
    assert.equal(opts.method ?? "GET", "GET");
    paths.push(url);
    if (url.includes("/pulls?")) return [pr(), pr({ number: 5, html_url: "https://github.com/company/client/pull/5", head: { ref: "manual/fix", sha: SHA, repo: { full_name: REPO } } })];
    if (url.endsWith("/pulls/4")) return pr();
    if (url.includes("/commits/") && url.endsWith("/status")) return { state: "success" };
    if (url.endsWith("check-runs?per_page=100")) return { check_runs: [{ status: "completed", conclusion: "success" }] };
    if (url.includes("/deployments?")) return [{ id: 123, sha: SHA, environment: "Preview" }];
    if (url.includes("/deployments/123/statuses")) return [{ state: "success", environment_url: "https://site-preview.vercel.app/" }];
    throw Error(url);
  };
  class ProviderError extends Error {}
  const reader = loadTs("lib/developer/github-review.ts", {
    "@/lib/providers/api": { providerJson: api },
    "@/lib/providers/errors": { ProviderError },
    "@/lib/developer/pr-model": model,
  });
  const options = { env: { GITHUB_TOKEN: "read-token" } };
  const list = await reader.listDeveloperPullRequests(REPO, options);
  assert.equal(list.length, 1);
  const review = await reader.readDeveloperReview(REPO, 4, options);
  assert.equal(review.pullRequest.headSha, SHA);
  assert.equal(review.checks, "passed");
  assert.equal(review.previewUrl, "https://site-preview.vercel.app/");
  assert.equal(review.requiresHumanApproval, true);
  assert.ok(paths.every((url) => url.startsWith("https://api.github.com/repos/company/client/")));
  await assert.rejects(reader.readDeveloperReview("../secret", 4, options));
});

test("Developer has no automatic deployment, push, or merge permission", () => {
  const { registry } = loadRegistry();
  const agent = registry.agentDefinitions.developer;
  assert.equal(agent.defaultAutonomy, 1);
  assert.equal(agent.runTypes.length, 0);
  assert.equal(agent.tools.length, 0);
  assert.equal(registry.capabilities.review_developer_pr.permission, "read");
  assert.equal(registry.capabilities.open_developer_pr.permission, "execute");
  assert.equal(registry.capabilities.open_developer_pr.externalEffect, true);
});
