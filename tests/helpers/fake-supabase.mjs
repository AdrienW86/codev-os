// Faux client Supabase en mémoire pour les tests de services métier.
// Couvre select/eq/neq/in/is/lt/lte/gt/gte/order/limit/range/maybeSingle/single,
// insert/update/upsert/delete, rpc, contraintes d'unicité et pannes injectées.
import { randomUUID } from "node:crypto";

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function createFakeSupabase(initial = {}, options = {}) {
  const tables = Object.fromEntries(Object.entries(initial).map(([name, rows]) => [name, clone(rows)]));
  const calls = [];
  const unique = options.unique ?? {};

  function violates(table, row, ignore) {
    for (const columns of unique[table] ?? []) {
      if (columns.some((column) => row[column] === null || row[column] === undefined)) continue;
      if ((tables[table] ?? []).some((other) => other !== ignore && columns.every((column) => other[column] === row[column]))) return true;
    }
    return false;
  }

  function builder(table) {
    const state = { op: "select", filters: [], order: [], limit: null, single: null, payload: null, returning: false, onConflict: null, ignoreDuplicates: false };
    const rows = () => (tables[table] ??= []);
    const matches = (row) => state.filters.every((filter) => filter(row));
    const api = {
      select(columns) { if (state.op === "select") state.columns = columns; else state.returning = true; return api; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return api; },
      neq(column, value) { state.filters.push((row) => row[column] !== value); return api; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return api; },
      is(column, value) { state.filters.push((row) => (row[column] ?? null) === value); return api; },
      lt(column, value) { state.filters.push((row) => row[column] !== null && row[column] < value); return api; },
      lte(column, value) { state.filters.push((row) => row[column] !== null && row[column] <= value); return api; },
      gt(column, value) { state.filters.push((row) => row[column] !== null && row[column] > value); return api; },
      gte(column, value) { state.filters.push((row) => row[column] !== null && row[column] >= value); return api; },
      not(column, operator, value) { if (operator === "is") state.filters.push((row) => (row[column] ?? null) !== value); return api; },
      or() { return api; },
      order(column, { ascending = true } = {}) { state.order.push([column, ascending]); return api; },
      limit(count) { state.limit = count; return api; },
      range(from, to) { state.range = [from, to]; return api; },
      maybeSingle() { state.single = "maybe"; return api; },
      single() { state.single = "one"; return api; },
      insert(payload) { state.op = "insert"; state.payload = payload; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      upsert(payload, { onConflict, ignoreDuplicates } = {}) { state.op = "upsert"; state.payload = payload; state.onConflict = onConflict; state.ignoreDuplicates = Boolean(ignoreDuplicates); return api; },
      delete() { state.op = "delete"; return api; },
      then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
    };

    function finish(data) {
      let result = data;
      for (const [column, ascending] of [...state.order].reverse()) result = [...result].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
      if (state.range) result = result.slice(state.range[0], state.range[1] + 1);
      if (state.limit !== null) result = result.slice(0, state.limit);
      if (state.single === "maybe") {
        if (result.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        return { data: clone(result[0] ?? null), error: null };
      }
      if (state.single === "one") return result.length === 1 ? { data: clone(result[0]), error: null } : { data: null, error: { code: "PGRST116", message: "not single" } };
      return { data: clone(result), error: null };
    }

    function execute() {
      calls.push([table, state.op, clone(state.payload)]);
      const failure = options.failOn?.(table, state.op, state.payload);
      if (failure) return { data: null, error: failure === true ? { message: "injected failure" } : failure };
      if (state.op === "select") return finish(rows().filter(matches));
      if (state.op === "insert" || state.op === "upsert") {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        const written = [];
        for (const item of list) {
          const row = { id: item.id ?? randomUUID(), created_at: new Date().toISOString(), ...clone(item) };
          if (state.op === "upsert" && state.onConflict) {
            const keys = state.onConflict.split(",");
            const existing = rows().find((other) => keys.every((key) => other[key] === row[key]));
            if (existing) { if (!state.ignoreDuplicates) { Object.assign(existing, clone(item)); written.push(existing); } continue; }
          }
          if (violates(table, row)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          rows().push(row);
          written.push(row);
        }
        return state.returning || state.single ? finish(written) : { data: null, error: null };
      }
      if (state.op === "update") {
        const targets = rows().filter(matches);
        for (const row of targets) {
          const next = { ...row, ...clone(state.payload) };
          if (violates(table, next, row)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          Object.assign(row, clone(state.payload));
        }
        return state.returning || state.single ? finish(targets) : { data: null, error: null };
      }
      if (state.op === "delete") {
        const kept = rows().filter((row) => !matches(row));
        const removed = rows().filter(matches);
        tables[table] = kept;
        return state.returning ? finish(removed) : { data: null, error: null };
      }
      return { data: null, error: { message: "unsupported" } };
    }
    return api;
  }

  return {
    tables, calls,
    client: {
      from: (table) => builder(table),
      rpc: async (name, args) => {
        calls.push(["rpc", name, clone(args)]);
        const handler = options.rpc?.[name];
        if (!handler) return { data: null, error: { message: `unknown rpc ${name}` } };
        try { return { data: await handler(args, tables), error: null }; } catch (error) { return { data: null, error: { message: error.message } }; }
      },
    },
  };
}
