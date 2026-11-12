#!/usr/bin/env node
// Serves dist/ the way GitHub Pages does: directories → index.html, misses → 404.html (status 404).
//
//   node scripts/serve.mjs [port] [dir]        (defaults: 8080, dist)
//
// Dependency-free; Node 20+. scripts/dev.mjs reuses serveFile() with an HTML hook for live reload.

import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".ttl": "text/turtle; charset=utf-8", ".wasm": "application/wasm",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
};

// `html`, when given, rewrites every HTML response body (a string) before it is sent.
export function serveFile(req, res, root, html) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  path = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, path);
  let status = 200;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && !extname(file) && existsSync(file + ".html")) file += ".html";
  if (!existsSync(file) || statSync(file).isDirectory()) { status = 404; file = join(root, "404.html"); }
  if (!existsSync(file)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
  res.writeHead(status, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  if (html && extname(file) === ".html") return res.end(html(readFileSync(file, "utf8")));
  createReadStream(file).pipe(res);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  const root = process.argv[3] || "dist";
  createServer((req, res) => serveFile(req, res, root)).listen(port, () => console.log(`serve: http://localhost:${port}/  (${root})`));
}
