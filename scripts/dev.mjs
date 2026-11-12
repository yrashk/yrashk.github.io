#!/usr/bin/env node
// Local authoring loop: builds dist/, serves it like scripts/serve.mjs, and rebuilds whenever
// anything under site/ (posts, notes, templates, the shell, data, static) or the generator changes.
// Open pages reload themselves after each successful build.
//
//   node scripts/dev.mjs [port]                 (default: 8080)
//
// Dependency-free; Node 20+. Dev only: the reload script is injected at serve time, never into dist/.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { serveFile } from "./serve.mjs";

const port = Number(process.argv[2] || process.env.PORT || 8080);
const WATCH = ["site", "scripts/build.mjs"];
const IGNORE = /(^|[/\\])\.|~$|\.swp$|\.tmp$/; // dotfiles, editor backups and atomic-save temporaries
const RELOAD = `<script>new EventSource("/__dev/events").addEventListener("reload", () => location.reload());</script>`;

const clients = new Set();
let building = false, again = false, timer;

function build() {
  if (building) { again = true; return; }
  building = true;
  const started = Date.now();
  const child = spawn(process.execPath, ["scripts/build.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.on("exit", (code) => {
    building = false;
    if (code === 0) {
      console.log(`dev: rebuilt in ${Date.now() - started} ms; reloading ${clients.size} page(s)`);
      for (const res of clients) res.write("event: reload\ndata: \n\n");
    } else {
      console.log(out.trim());
      console.log("dev: build failed (pages keep the last good build)");
    }
    if (again) { again = false; build(); }
  });
}

for (const target of WATCH) {
  watch(target, { recursive: true }, (_event, name) => {
    if (name && IGNORE.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(build, 80);
  });
}

createServer((req, res) => {
  if (req.url === "/__dev/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  serveFile(req, res, "dist", (html) => html.includes("</body>") ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, RELOAD + "</body>") : html + RELOAD);
}).listen(port, () => console.log(`dev: http://localhost:${port}/  (watching ${WATCH.join(", ")})`));

build();
