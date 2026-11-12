// Injected by scripts/dev.mjs into every served HTML page (never into dist/).
// On a rebuild, reader pages fetch their fresh HTML and patch only the blocks that changed, in place:
// inserted words glow in, deleted words strike through and collapse, scroll stays where it is.
// Anything outside the article and rail (template, styles, scripts) changing, or any other page,
// falls back to a full reload that keeps the scroll position.

(() => {
  const KEY = "__dev-scroll:" + location.pathname;
  const scroller = () => document.getElementById("scroller") || document.scrollingElement;
  try {
    const y = sessionStorage.getItem(KEY);
    if (y != null) { sessionStorage.removeItem(KEY); addEventListener("load", () => { scroller().scrollTop = +y; }); }
  } catch {}
  const reload = () => {
    try { sessionStorage.setItem(KEY, String(scroller().scrollTop)); } catch {}
    location.reload();
  };

  // Regions that are patched in place; everything else must be unchanged or the page reloads.
  const REGIONS = ["#article", ".rail dl", ".rail .tags", ".rail .toc-wrap"];
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const fetchDoc = async () => parse(await (await fetch(location.href, { cache: "no-store" })).text());
  let prev = document.getElementById("prose") ? fetchDoc().catch(() => null) : null;

  const style = document.createElement("style");
  style.textContent = `
    .__dev-ins{border-radius:2px;animation:__dev-ins 1.6s cubic-bezier(.2,.7,.2,1) both}
    @keyframes __dev-ins{0%{opacity:0;filter:blur(6px);background:var(--signal-glow,rgba(255,106,61,.55))}
      35%{opacity:1;filter:blur(0);background:var(--signal-dim,rgba(255,106,61,.16))}100%{background:transparent}}
    .__dev-del{display:inline-block;vertical-align:bottom;overflow:hidden;white-space:pre;text-decoration:line-through;
      color:var(--signal-2,#ffa98a);animation:__dev-del .9s ease-in forwards}
    @keyframes __dev-del{0%{max-width:40ch;opacity:.9}60%{opacity:0;filter:blur(3px)}100%{max-width:0;opacity:0}}
    .__dev-block{animation:__dev-block 1.2s cubic-bezier(.2,.7,.2,1) both}
    @keyframes __dev-block{0%{opacity:0;filter:blur(6px);transform:translateY(4px)}100%{opacity:1;filter:none;transform:none}}
    @media (prefers-reduced-motion:reduce){.__dev-ins,.__dev-del,.__dev-block{animation:none}.__dev-del{display:none}}`;
  document.head.append(style);

  // LCS diff of two string arrays → [{op: "eq"|"ins"|"del", i, j, w}] (i into a, j into b, w the string).
  const words = (t) => t.split(/\s+/).filter(Boolean);
  function diff(a, b) {
    if (a.length * b.length > 4e6) return null;
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ op: "eq", i, j, w: b[j] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ op: "del", i, w: a[i] }); i++; }
      else { ops.push({ op: "ins", j, w: b[j] }); j++; }
    }
    for (; i < n; i++) ops.push({ op: "del", i, w: a[i] });
    for (; j < m; j++) ops.push({ op: "ins", j, w: b[j] });
    return ops;
  }

  const span = (cls, text) => Object.assign(document.createElement("span"), { className: cls, textContent: text });

  // Returns a copy of `next` whose text marks what changed relative to `old`, or null if no word changed.
  function marked(old, next) {
    const ops = diff(words(old.textContent), words(next.textContent));
    if (!ops || !ops.some((o) => o.op !== "eq")) return null;
    const out = document.importNode(next, true);
    const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest("pre,code,svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const texts = [];
    for (let t; (t = walker.nextNode()); ) texts.push(t);
    let k = 0;
    const dels = () => { const f = document.createDocumentFragment(); while (k < ops.length && ops[k].op === "del") f.append(span("__dev-del", ops[k++].w + " ")); return f; };
    for (const t of texts) {
      const f = document.createDocumentFragment();
      for (const part of t.data.split(/(\s+)/)) {
        if (!part || /^\s+$/.test(part)) { if (part) f.append(part); continue; }
        f.append(dels());
        const o = ops[k++];
        f.append(o && o.op === "ins" ? span("__dev-ins", part) : part);
      }
      t.replaceWith(f);
    }
    if (k < ops.length) out.append(dels());
    return out;
  }

  const settle = (root) => setTimeout(() => {
    root.querySelectorAll(".__dev-del").forEach((s) => s.remove());
    root.querySelectorAll(".__dev-ins").forEach((s) => s.replaceWith(s.textContent));
    root.querySelectorAll(".__dev-block").forEach((s) => s.classList.remove("__dev-block"));
    root.classList.remove("__dev-block");
    if (!root.classList.length) root.removeAttribute("class");
    root.normalize();
  }, 1700);

  const block = (n) => { const fresh = document.importNode(n, true); fresh.classList.add("__dev-block"); settle(fresh); return fresh; };

  function replace(node, o, n) {
    if (o.id === "prose") return patch(node, o, n);
    const m = o.tagName === n.tagName ? marked(o, n) : null;
    if (!m) return node.replaceWith(block(n));
    node.replaceWith(m);
    settle(m);
  }

  // Patch the live children of `live` from prevEl → nextEl. Unchanged blocks are left alone; each run of
  // changed blocks pairs old with new (word-level morph), then removes or inserts whatever is left over.
  function patch(live, prevEl, nextEl) {
    const a = [...prevEl.children], b = [...nextEl.children], l = [...live.children];
    const ops = l.length === a.length && diff(a.map((x) => x.outerHTML), b.map((x) => x.outerHTML));
    if (!ops) return live.replaceWith(block(nextEl));
    for (let k = 0; k < ops.length; ) {
      if (ops[k].op === "eq") { k++; continue; }
      const dels = [], ins = [];
      for (; k < ops.length && ops[k].op !== "eq"; k++) (ops[k].op === "del" ? dels : ins).push(ops[k]);
      const anchor = k < ops.length ? l[ops[k].i] : null;
      const pairs = Math.min(dels.length, ins.length);
      for (let p = 0; p < pairs; p++) replace(l[dels[p].i], a[dels[p].i], b[ins[p].j]);
      for (const d of dels.slice(pairs)) l[d.i].remove();
      for (const x of ins.slice(pairs)) live.insertBefore(block(b[x.j]), anchor);
    }
  }

  const outside = (doc) => {
    const c = doc.documentElement.cloneNode(true);
    for (const sel of REGIONS) c.querySelectorAll(sel).forEach((x) => x.replaceChildren());
    c.querySelectorAll("title").forEach((x) => x.replaceChildren());
    return c.outerHTML;
  };

  async function update() {
    const before = prev && (await prev);
    if (!before || !document.getElementById("prose")) return reload();
    let next;
    try { next = await fetchDoc(); } catch { return reload(); }
    if (!next.getElementById("prose") || outside(before) !== outside(next)) return reload();
    for (const sel of REGIONS) {
      const live = document.querySelector(sel), o = before.querySelector(sel), n = next.querySelector(sel);
      if (!live || !o || !n) return reload();
      if (o.outerHTML !== n.outerHTML) patch(live, o, n);
    }
    document.title = next.title;
    prev = Promise.resolve(next);
  }

  let queue = Promise.resolve();
  new EventSource("/__dev/events").addEventListener("reload", () => { queue = queue.then(update, update); });
})();
