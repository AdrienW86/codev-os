// E2E UNIQUEMENT — passerelle locale qui imite l'API REST Supabase devant PostgREST :
// /rest/v1/* → PostgREST, la clé sb_secret_ de test est échangée contre un JWT service_role local.
import { createHmac } from "node:crypto";
import http from "node:http";

export function serviceJwt(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "service_role", iss: "codev-e2e", exp: Math.floor(Date.now() / 1000) + 86_400 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function startGateway({ port, upstreamPort, apiKey, jwtSecret }) {
  const token = serviceJwt(jwtSecret);
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/rest/v1/") || request.headers.apikey !== apiKey) { response.writeHead(401).end("unauthorized"); return; }
    const headers = { ...request.headers, authorization: `Bearer ${token}`, host: `127.0.0.1:${upstreamPort}` };
    delete headers.apikey;
    const upstream = http.request({ host: "127.0.0.1", port: upstreamPort, method: request.method, path: request.url.slice("/rest/v1".length), headers }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("upstream error"); });
    request.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
