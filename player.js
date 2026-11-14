/* yrashk.com floating talk player.
 *
 * One player for the whole site: the desktop shell and every reader page load this file. It floats above the
 * page, survives workspace switches (it is not a window of the tiling layout), and resumes across page loads:
 * its state (talk, position, mode, place) lives in sessionStorage["yr-player"].
 *
 *   YRPlayer.open(talk, {at, mode})   talk = an atlas.json body of kind "talk" (see site/DATA.md)
 *   YRPlayer.current()                → the talk id playing (or paused) now, or null
 *   addEventListener('yr-player', e)  e.detail = {id, state: 'playing'|'paused'|'ended'|'closed'|'error'}
 *
 * Video goes through the YouTube IFrame API with YouTube's own controls off; the controls are ours. A talk cut
 * out of a longer stream (video.start / video.end, in seconds) plays as if it were its own video: the scrubber,
 * the clock and "ended" all live inside the cut; video.full (the whole stream, as a talk) adds "watch the whole
 * day", which switches to it at the same moment. A whole stream may carry video.chapters [{t, title, speaker}]:
 * ticks on the scrubber, the current chapter under the title, previous/next and a list to jump from;
 * video.from is where it starts playing the first time. When the API can't load or the video refuses to embed, the
 * player says so and offers the YouTube link at the current time; talks recorded elsewhere (InfoQ, O'Reilly)
 * never reach the player, their entries link straight out.
 */
(function () {
  if (window.YRPlayer) return;
  const KEY = "yr-player";
  const MODES = ["full", "mini", "big"];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const clock = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
  const watchUrl = (v, at) => `https://www.youtube.com/watch?v=${v.yt}${at > 1 ? `&t=${Math.floor(at)}s` : ""}`;

  /* ── styles (site tokens with fallbacks, so it reads right on the shell and in the reader) ── */
  const css = `
#yrp{--p-bg:var(--panel,#121518);--p-bg2:var(--panel-2,#181c21);--p-line:var(--line-2,#30373f);--p-ink:var(--bone,#e9e4d9);--p-ink2:var(--bone-2,#b7b1a6);--p-ink3:var(--bone-3,#8a8479);--p-sig:var(--signal,#ff6a3d);--p-mono:var(--mono,"IBM Plex Mono",ui-monospace,Menlo,monospace);--p-serif:var(--serif,"Instrument Serif",Georgia,serif);
  position:fixed;z-index:60;right:18px;bottom:18px;width:min(460px,calc(100vw - 24px));background:var(--p-bg);color:var(--p-ink);border:1px solid var(--p-line);border-radius:9px;
  box-shadow:0 24px 70px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.2);font:13px/1.4 var(--sans,system-ui,sans-serif);overflow:hidden;user-select:none;-webkit-user-select:none}
:root[data-theme="paper"] #yrp{box-shadow:0 22px 60px rgba(40,30,20,.25)}
#yrp *{box-sizing:border-box}
#yrp button{all:unset;cursor:pointer;display:inline-grid;place-items:center;min-width:26px;height:26px;border-radius:5px;color:var(--p-ink2);font:500 12px/1 var(--p-mono)}
#yrp button:hover{color:var(--p-ink);background:var(--p-bg2)}
#yrp button:focus-visible{outline:1px solid var(--p-sig);outline-offset:1px}
#yrp .yp-h{display:flex;align-items:center;gap:8px;height:30px;padding:0 4px 0 10px;border-bottom:1px solid var(--p-line);cursor:grab;font:500 10.5px/1 var(--p-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--p-ink3)}
#yrp .yp-h:active{cursor:grabbing}
#yrp .yp-h .yp-live{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--p-ink3);flex:none}
#yrp[data-state="playing"] .yp-h .yp-live{background:var(--p-sig);box-shadow:0 0 8px var(--p-sig);animation:yrp-pulse 1.6s infinite}
@keyframes yrp-pulse{50%{opacity:.35}}
#yrp .yp-h .yp-lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#yrp .yp-h button{text-transform:none;letter-spacing:0;font-size:13px}
#yrp .yp-scr{position:relative;aspect-ratio:16/9;background:#000}
#yrp .yp-scr .yp-yt,#yrp .yp-scr iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
#yrp .yp-shield{position:absolute;inset:0;cursor:pointer;display:grid;place-items:center;background:transparent}
#yrp .yp-big-play{width:58px;height:58px;border-radius:50%;background:rgba(12,14,17,.72);border:1px solid rgba(233,228,217,.25);display:grid;place-items:center;color:#e9e4d9;font-size:20px;transition:opacity .2s,transform .2s;pointer-events:none}
#yrp[data-state="playing"] .yp-big-play{opacity:0;transform:scale(.9)}
#yrp .yp-msg{position:absolute;inset:0;display:none;place-content:center;gap:10px;text-align:center;padding:18px;background:var(--p-bg);color:var(--p-ink2)}
#yrp .yp-msg b{font:400 20px/1.2 var(--p-serif);color:var(--p-ink)}
#yrp .yp-msg a{color:var(--p-sig);font:500 12px var(--p-mono);text-decoration:none}
#yrp[data-state="error"] .yp-msg{display:grid}
#yrp .yp-meta{padding:10px 12px 2px}
#yrp .yp-meta .yp-t{font:400 19px/1.2 var(--p-serif);color:var(--p-ink);margin:0}
#yrp .yp-meta .yp-e{font:400 11px/1.5 var(--p-mono);color:var(--p-ink3);margin-top:3px}
#yrp .yp-bar{display:flex;align-items:center;gap:2px;padding:6px 6px 8px}
#yrp .yp-tm{font:400 11px var(--p-mono);color:var(--p-ink3);padding:0 6px;white-space:nowrap;font-variant-numeric:tabular-nums}
#yrp .yp-sp{flex:1}
#yrp .yp-seek{position:relative;height:16px;margin:0 12px;cursor:pointer;touch-action:none}
#yrp .yp-seek::before{content:"";position:absolute;left:0;right:0;top:7px;height:2px;background:var(--p-line);border-radius:2px}
#yrp .yp-seek .yp-fill{position:absolute;left:0;top:7px;height:2px;background:var(--p-sig);border-radius:2px;width:0}
#yrp .yp-seek .yp-knob{position:absolute;top:3px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--p-sig);box-shadow:0 0 0 3px var(--p-bg);left:0;transition:transform .15s}
#yrp .yp-seek:hover .yp-knob{transform:scale(1.25)}
#yrp .yp-seek:focus-visible{outline:1px solid var(--p-sig);outline-offset:2px;border-radius:3px}
#yrp .yp-cut{font:400 10px var(--p-mono);color:var(--p-ink3);padding:0 12px;letter-spacing:.04em}
#yrp .yp-cut i{font-style:normal;color:var(--p-sig)}
#yrp .yp-cut button{min-width:0;height:auto;padding:0 2px;font:400 10px var(--p-mono);color:var(--p-sig);text-decoration:underline;text-underline-offset:2px}
#yrp .yp-ch{font:400 11px/1.45 var(--p-mono);color:var(--p-ink2);margin-top:4px;min-height:1.45em}
#yrp .yp-ch i{font-style:normal;color:var(--p-sig)}
#yrp .yp-ch:empty{display:none}
#yrp .yp-tick{position:absolute;top:4px;width:1px;height:8px;background:var(--p-ink3);pointer-events:none}
#yrp .yp-chs{list-style:none;margin:0;padding:4px 6px 8px;max-height:min(40vh,320px);overflow:auto;border-top:1px solid var(--p-line)}
#yrp .yp-chs li button{all:unset;cursor:pointer;display:grid;grid-template-columns:62px 1fr;gap:8px;width:100%;box-sizing:border-box;padding:6px 6px;border-radius:5px;font:400 12.5px/1.35 var(--sans,system-ui,sans-serif);color:var(--p-ink2);height:auto}
#yrp .yp-chs li button:hover{background:var(--p-bg2);color:var(--p-ink)}
#yrp .yp-chs li button:focus-visible{outline:1px solid var(--p-sig)}
#yrp .yp-chs li time{font:400 11px var(--p-mono);color:var(--p-ink3);padding-top:1px;font-variant-numeric:tabular-nums}
#yrp .yp-chs li small{display:block;font:400 11px var(--p-mono);color:var(--p-ink3);margin-top:1px}
#yrp .yp-chs li.on button{color:var(--p-ink)}
#yrp .yp-chs li.on time{color:var(--p-sig)}
#yrp:not([data-chapters]) [data-a="prevch"],#yrp:not([data-chapters]) [data-a="nextch"],#yrp:not([data-chapters]) [data-a="chlist"]{display:none}
#yrp[data-mode="mini"] .yp-chs,#yrp[data-mode="mini"] .yp-ch,#yrp[data-mode="mini"] [data-a="prevch"],#yrp[data-mode="mini"] [data-a="nextch"],#yrp[data-mode="mini"] [data-a="chlist"]{display:none}
/* mini: a strip that keeps playing — a small live picture, the title, the clock */
#yrp[data-mode="mini"]{width:min(400px,calc(100vw - 24px))}
#yrp[data-mode="mini"] .yp-h{display:none}
#yrp[data-mode="mini"] .yp-body{display:grid;grid-template-columns:128px 1fr;grid-template-rows:auto auto;align-items:center}
#yrp[data-mode="mini"] .yp-scr{grid-row:1 / 3;width:128px;height:100%;min-height:72px;aspect-ratio:auto;border-right:1px solid var(--p-line)}
#yrp[data-mode="mini"] .yp-big-play{width:30px;height:30px;font-size:11px}
#yrp[data-mode="mini"] .yp-meta{padding:8px 10px 0;min-width:0}
#yrp[data-mode="mini"] .yp-meta .yp-t{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#yrp[data-mode="mini"] .yp-meta .yp-e{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#yrp[data-mode="mini"] .yp-seek,#yrp[data-mode="mini"] .yp-cut,#yrp[data-mode="mini"] [data-a="back"],#yrp[data-mode="mini"] [data-a="fwd"],#yrp[data-mode="mini"] [data-a="rate"],#yrp[data-mode="mini"] [data-a="mute"]{display:none}
#yrp[data-mode="mini"] .yp-bar{padding:2px 4px 4px 4px}
#yrp[data-mode="mini"] .yp-line{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--p-line)}
#yrp[data-mode="mini"] .yp-line i{display:block;height:100%;background:var(--p-sig);width:0}
#yrp:not([data-mode="mini"]) .yp-line,#yrp:not([data-mode="mini"]) [data-a="expand"],#yrp:not([data-mode="mini"]) .yp-mini-x{display:none}
#yrp[hidden]{display:none}
/* big: a theatre, still not modal */
#yrp[data-mode="big"]{width:min(1100px,calc(100vw - 48px),calc((100vh - 200px) * 16 / 9))}
#yrp[data-mode="big"] .yp-meta .yp-t{font-size:24px}
@media (max-width:760px){
  #yrp,#yrp[data-mode="big"]{left:8px!important;right:8px!important;top:auto!important;width:auto;bottom:calc(var(--dock,0px) + 8px)!important}
  #yrp .yp-h{cursor:default}
  #yrp [data-a="big"]{display:none}
}
@media (prefers-reduced-motion:reduce){#yrp *{animation:none!important;transition:none!important}}
`;

  /* ── state ── */
  let st = null; // {talk, at, mode, playing, pos:{x,y}|null}
  let el = null, yt = null, ready = false, timer = null, apiP = null, failTimer = null, rate = 1;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } };
  const persist = () => {
    try {
      if (!st) { sessionStorage.removeItem(KEY); return; }
      if (ready) st.at = now();
      sessionStorage.setItem(KEY, JSON.stringify(st));
    } catch (e) {}
  };
  const emit = (state) => dispatchEvent(new CustomEvent("yr-player", { detail: { id: st && st.talk.id, state } }));
  const seg = () => {
    const v = st.talk.video, s = v.chapters ? 0 : v.start || 0;
    const d = yt && ready && yt.getDuration ? yt.getDuration() : 0;
    const e = v.end || (v.dur ? s + v.dur : d);
    return { s, e, len: Math.max(0, e - s) };
  };
  const now = () => (yt && ready && yt.getCurrentTime ? yt.getCurrentTime() : st ? st.at : 0);

  /* ── the IFrame API, loaded once ── */
  function api() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiP) return apiP;
    apiP = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} res(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => rej(new Error("YouTube is unreachable"));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("YouTube took too long")), 12000);
    });
    apiP.catch(() => { apiP = null; });
    return apiP;
  }

  /* ── DOM ── */
  function build() {
    if (!$("#yrp-css")) { const s = document.createElement("style"); s.id = "yrp-css"; s.textContent = css; document.head.appendChild(s); }
    el = document.createElement("section");
    el.id = "yrp"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Talk player"); el.tabIndex = -1;
    el.innerHTML = `
<div class="yp-h" data-drag><span class="yp-live" aria-hidden="true"></span><span class="yp-lbl">talk</span>
  <button data-a="yt" title="Watch on YouTube at this moment" aria-label="Open on YouTube">↗</button>
  <button data-a="min" title="Minimize — keeps playing (m)" aria-label="Minimize">–</button>
  <button data-a="big" title="Enlarge (f)" aria-label="Enlarge">⤢</button>
  <button data-a="close" title="Close" aria-label="Close player">×</button></div>
<div class="yp-body">
  <div class="yp-scr"><div class="yp-yt"></div><div class="yp-shield" data-a="toggle" aria-hidden="true"><span class="yp-big-play">▶</span></div>
    <div class="yp-msg"><b>This recording won't play here.</b><span class="yp-why"></span><a class="yp-out" target="_blank" rel="noopener">Watch on YouTube ↗</a></div></div>
  <div class="yp-meta"><p class="yp-t"></p><div class="yp-e"></div><div class="yp-ch" aria-live="polite"></div></div>
  <div class="yp-seek" role="slider" tabindex="0" aria-label="Seek"><span class="yp-fill"></span><span class="yp-knob"></span></div>
  <div class="yp-cut"></div>
  <div class="yp-bar">
    <button data-a="toggle" aria-label="Play">▶</button>
    <button data-a="back" title="Back 10 s" aria-label="Back 10 seconds">−10</button>
    <button data-a="fwd" title="Forward 10 s" aria-label="Forward 10 seconds">+10</button>
    <button data-a="prevch" title="Previous talk" aria-label="Previous chapter">|◂</button>
    <button data-a="nextch" title="Next talk" aria-label="Next chapter">▸|</button>
    <span class="yp-tm">0:00</span><span class="yp-sp"></span>
    <button data-a="chlist" title="All talks in this video" aria-label="Chapters" aria-expanded="false">≡</button>
    <button data-a="rate" title="Playback speed" aria-label="Playback speed">1×</button>
    <button data-a="mute" title="Mute" aria-label="Mute">♪</button>
    <button data-a="expand" title="Expand" aria-label="Expand player">⤢</button>
    <button data-a="close" class="yp-mini-x" title="Close" aria-label="Close player">×</button>
  </div>
  <ol class="yp-chs" hidden></ol>
  <div class="yp-line"><i></i></div>
</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    seekUI();
    dragUI();
    addEventListener("resize", clamp);
  }
  function onClick(e) {
    const b = e.target.closest("[data-a]"); if (!b || !st) return;
    const a = b.dataset.a;
    if (a === "toggle") toggle();
    else if (a === "back") seekTo(now() - 10);
    else if (a === "fwd") seekTo(now() + 10);
    else if (a === "min") setMode("mini");
    else if (a === "expand") setMode("full");
    else if (a === "big") setMode(st.mode === "big" ? "full" : "big");
    else if (a === "close") close();
    else if (a === "yt") window.open(watchUrl(st.talk.video, now()), "_blank", "noopener");
    else if (a === "rate") { const R = [1, 1.25, 1.5, 1.75, 2]; rate = R[(R.indexOf(rate) + 1) % R.length]; if (ready) yt.setPlaybackRate(rate); b.textContent = rate + "×"; }
    else if (a === "prevch" || a === "nextch") { const C = st.talk.video.chapters || [], i = chapterAt(now()); const j = a === "nextch" ? i + 1 : (i >= 0 && now() - C[i].t > 5 ? i : i - 1); if (C[Math.max(0, j)] && j < C.length) jump(C[Math.max(0, j)].t); }
    else if (a === "chlist") { const L = $(".yp-chs", el); L.hidden = !L.hidden; b.setAttribute("aria-expanded", String(!L.hidden)); if (!L.hidden) { const on = $(".yp-chs li.on", el); if (on) on.scrollIntoView({ block: "nearest" }); } }
    else if (a === "chapter") jump(+b.dataset.t);
    else if (a === "day") { const f = st.talk.video.full; if (f) open(f, { at: now(), mode: st.mode, pos: st.pos }); }
    else if (a === "mute") { if (!ready) return; if (yt.isMuted()) { yt.unMute(); b.textContent = "♪"; b.style.opacity = ""; } else { yt.mute(); b.textContent = "♪"; b.style.opacity = ".4"; } }
  }
  function onKey(e) {
    if (e.target.closest(".yp-seek")) {
      if (e.key === "ArrowLeft") { seekTo(now() - 5); e.preventDefault(); }
      if (e.key === "ArrowRight") { seekTo(now() + 5); e.preventDefault(); }
    }
    if (e.key === " " && !e.target.closest("button")) { toggle(); e.preventDefault(); }
    if (e.key === "m") setMode(st.mode === "mini" ? "full" : "mini");
    if (e.key === "f") setMode(st.mode === "big" ? "full" : "big");
    if (e.key === "Escape") setMode("mini");
    e.stopPropagation(); // the shell's own shortcuts stay out of the player
  }
  function seekUI() {
    const sk = $(".yp-seek", el);
    const at = (x) => { const r = sk.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (x - r.left) / r.width)); const g = seg(); return g.s + f * g.len; };
    let dragging = false;
    sk.addEventListener("pointerdown", (e) => { dragging = true; sk.setPointerCapture(e.pointerId); paint(at(e.clientX)); });
    sk.addEventListener("pointermove", (e) => { if (dragging) paint(at(e.clientX)); });
    sk.addEventListener("pointerup", (e) => { if (!dragging) return; dragging = false; seekTo(at(e.clientX)); });
    sk._dragging = () => dragging;
  }
  function dragUI() {
    const h = $("[data-drag]", el);
    let o = null;
    h.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || matchMedia("(max-width:760px)").matches || st.mode === "big") return;
      const r = el.getBoundingClientRect(); o = { dx: e.clientX - r.left, dy: e.clientY - r.top }; h.setPointerCapture(e.pointerId);
    });
    h.addEventListener("pointermove", (e) => { if (!o) return; place(e.clientX - o.dx, e.clientY - o.dy); });
    h.addEventListener("pointerup", () => { if (!o) return; o = null; const r = el.getBoundingClientRect(); st.pos = { x: r.left, y: r.top }; persist(); });
    h.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) { st.pos = null; place(); persist(); } });
  }
  function place(x, y) {
    if (x == null) { el.style.left = el.style.top = ""; el.style.right = el.style.bottom = ""; return; }
    const r = el.getBoundingClientRect();
    x = Math.min(innerWidth - r.width - 6, Math.max(6, x)); y = Math.min(innerHeight - r.height - 6, Math.max(6, y));
    el.style.left = x + "px"; el.style.top = y + "px"; el.style.right = "auto"; el.style.bottom = "auto";
  }
  function clamp() { if (!el) return; if (st.mode === "big") return centre(); if (st.pos) place(st.pos.x, st.pos.y); }
  function centre() { const r = el.getBoundingClientRect(); place((innerWidth - r.width) / 2, Math.max(48, (innerHeight - r.height) / 2)); }

  function setMode(m) {
    if (!st || !MODES.includes(m)) return;
    st.mode = m; el.dataset.mode = m;
    if (el.dataset.ev != null) $(".yp-meta .yp-e", el).textContent = el.dataset.ev; lastCh = -2; // the strip shows the chapter, the full player the event
    $('[data-a="big"]', el).textContent = m === "big" ? "⤡" : "⤢";
    $('[data-a="big"]', el).title = m === "big" ? "Restore (f)" : "Enlarge (f)";
    if (m === "big") requestAnimationFrame(centre);
    else if (st.pos) requestAnimationFrame(() => place(st.pos.x, st.pos.y));
    else place();
    persist();
  }
  function setState(s) {
    el.dataset.state = s;
    const b = $('.yp-bar [data-a="toggle"]', el);
    b.textContent = s === "playing" ? "❚❚" : "▶";
    b.setAttribute("aria-label", s === "playing" ? "Pause" : "Play");
    $(".yp-big-play", el).textContent = s === "ended" ? "↺" : "▶";
    $(".yp-h .yp-lbl", el).textContent = s === "playing" ? "now playing" : s === "ended" ? "ended" : s === "error" ? "unavailable" : s === "loading" ? "loading" : "paused";
    if (st) { st.playing = s === "playing"; persist(); }
    emit(s);
  }
  /* chapters: which one holds time t, and the line under the title */
  function chapterAt(t) { const C = (st && st.talk.video.chapters) || []; let i = -1; C.forEach((c, k) => { if (c.t <= t + 0.5) i = k; }); return i; }
  function jump(t) { seekTo(t); if (ready && el.dataset.state !== "playing") yt.playVideo(); }
  let lastCh = -2, ticked = false;
  function chapters(cur) {
    const C = st.talk.video.chapters; if (!C) return;
    const g = seg();
    if (!ticked && g.len) { ticked = true; $(".yp-seek", el).insertAdjacentHTML("afterbegin", C.map((c) => `<span class="yp-tick" style="left:${((c.t - g.s) / g.len) * 100}%"></span>`).join("")); }
    const i = chapterAt(cur); if (i === lastCh) return; lastCh = i;
    const c = C[i];
    $(".yp-ch", el).innerHTML = c ? `<i>${i + 1}/${C.length}</i> ${c.speaker ? esc(c.speaker) + " — " : ""}${esc(c.title)}` : `${C.length} talks · the first at ${clock(C[0].t)}`;
    $$(".yp-chs li", el).forEach((li, k) => li.classList.toggle("on", k === i));
    if (st.mode === "mini" && c) $(".yp-meta .yp-e", el).textContent = (c.speaker ? c.speaker + " — " : "") + c.title;
  }
  function paint(t) {
    if (!st) return;
    const g = seg(); const cur = t != null ? t : now();
    const f = g.len ? Math.min(1, Math.max(0, (cur - g.s) / g.len)) : 0;
    $(".yp-seek .yp-fill", el).style.width = f * 100 + "%"; $(".yp-seek .yp-knob", el).style.left = f * 100 + "%";
    $(".yp-line i", el).style.width = f * 100 + "%";
    $(".yp-tm", el).textContent = `${clock(cur - g.s)} / ${g.len ? clock(g.len) : "–:––"}`;
    $(".yp-seek", el).setAttribute("aria-valuetext", `${clock(cur - g.s)} of ${clock(g.len)}`);
    chapters(cur);
  }
  function loop() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!st || !ready) return;
      const g = seg(), cur = now();
      if (st.talk.video.end && cur >= st.talk.video.end - 0.25 && el.dataset.state === "playing") { yt.pauseVideo(); setState("ended"); }
      if (!$(".yp-seek", el)._dragging()) paint();
      st.at = cur;
    }, 250);
    clearInterval(loop.p); loop.p = setInterval(persist, 2000);
  }
  function seekTo(t) {
    if (!st) return;
    const g = seg(); t = Math.min(g.e ? g.e - 0.5 : t, Math.max(g.s, t));
    st.at = t; paint(t);
    if (ready) { yt.seekTo(t, true); if (el.dataset.state === "ended") { yt.playVideo(); } }
    persist();
  }
  function toggle() {
    if (!st) return;
    if (el.dataset.state === "error") return;
    if (!ready) return;
    const s = el.dataset.state;
    if (s === "ended") { seekTo(seg().s); yt.playVideo(); return; }
    if (s === "playing") yt.pauseVideo(); else yt.playVideo();
  }
  function fail(why) {
    if (!st) return;
    setState("error");
    $(".yp-msg .yp-why", el).textContent = why;
    $(".yp-msg .yp-out", el).href = watchUrl(st.talk.video, now());
  }

  /* ── open / close ── */
  function open(talk, o = {}) {
    const v = talk && talk.video;
    if (!v || !v.yt) { const href = (v && v.href) || (talk && talk.url); if (href) window.open(href, "_blank", "noopener"); return; }
    if (st && st.talk.id === talk.id && el) { if (st.mode === "mini" && !o.mode) setMode("full"); if (ready && el.dataset.state !== "playing") toggle(); return; }
    teardown(false);
    st = { talk: { id: talk.id, name: talk.name, event: talk.event, venue: talk.venue, date: talk.date, start: talk.start, video: v }, at: o.at != null ? o.at : v.start || v.from || 0, mode: o.mode || "full", playing: true, pos: o.pos || null };
    if (!el) build();
    el.hidden = false;
    $(".yp-meta .yp-t", el).textContent = talk.name;
    el.dataset.ev = [talk.event, talk.venue && talk.venue !== "online" ? talk.venue : null, talk.date || talk.start].filter(Boolean).join(" · ");
    $(".yp-meta .yp-e", el).textContent = el.dataset.ev;
    $(".yp-cut", el).innerHTML = !v.chapters && (v.start || v.end) ? `cut from the event stream · <i>${clock(v.start || 0)}</i> – <i>${v.end ? clock(v.end) : "end"}</i>${v.full ? ` · <button data-a="day" title="Keep watching: the whole stream, from this moment">watch the whole day</button>` : ""}` : "";
    /* chapters: reset the ticks and the list for this video */
    ticked = false; lastCh = -2; $$(".yp-tick", el).forEach((t) => t.remove());
    const C = v.chapters || [];
    if (C.length) el.dataset.chapters = ""; else delete el.dataset.chapters;
    const L = $(".yp-chs", el); L.hidden = true; $('[data-a="chlist"]', el).setAttribute("aria-expanded", "false");
    L.innerHTML = C.map((c) => `<li><button data-a="chapter" data-t="${c.t}"><time>${clock(c.t)}</time><span>${esc(c.title)}${c.speaker ? `<small>${esc(c.speaker)}</small>` : ""}</span></button></li>`).join("");
    $(".yp-ch", el).textContent = "";
    setMode(st.mode); setState("loading"); paint(st.at);
    mount(o.autoplay !== false);
  }
  function mount(autoplay) {
    const box = document.createElement("div"); const holder = $(".yp-scr .yp-yt", el); holder.replaceChildren(box);
    clearTimeout(failTimer);
    api().then((YT) => {
      if (!st) return;
      const v = st.talk.video;
      yt = new YT.Player(box, {
        host: "https://www.youtube-nocookie.com", videoId: v.yt, width: "100%", height: "100%",
        playerVars: { start: Math.floor(st.at), ...(v.end ? { end: Math.ceil(v.end) } : {}), autoplay: autoplay ? 1 : 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => {
            ready = true; loop(); paint();
            if (rate !== 1) yt.setPlaybackRate(rate);
            if (autoplay) { yt.playVideo(); setTimeout(() => { if (st && ready && el.dataset.state !== "playing" && el.dataset.state !== "error") setState("paused"); }, 2500); } else setState("paused");
          },
          onStateChange: (e) => {
            const S = YT.PlayerState;
            if (e.data === S.PLAYING) setState("playing");
            else if (e.data === S.PAUSED) setState("paused");
            else if (e.data === S.ENDED) setState("ended");
            else if (e.data === S.CUED) setState("paused");
          },
          onError: (e) => fail(e.data === 100 ? "The video was removed or made private." : e.data === 101 || e.data === 150 ? "Its owner doesn't allow it to be embedded." : "YouTube couldn't play it."),
        },
      });
    }).catch((err) => fail(String(err.message || err) + "."));
  }
  function teardown(clear) {
    clearInterval(timer); clearInterval(loop.p); clearTimeout(failTimer);
    ready = false;
    if (yt && yt.destroy) try { yt.destroy(); } catch (e) {}
    yt = null;
    if (clear) { const id = st && st.talk.id; st = null; persist(); dispatchEvent(new CustomEvent("yr-player", { detail: { id, state: "closed" } })); }
  }
  function close() { teardown(true); if (el) { el.hidden = true; $(".yp-scr .yp-yt", el).replaceChildren(); } }

  /* keep the position across page loads */
  addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });

  window.YRPlayer = { open, close, current: () => (st ? st.talk.id : null), state: () => (el && st ? el.dataset.state : "closed") };

  /* resume what was playing on the previous page */
  const resume = () => {
    const s = read(); if (!s || !s.talk || !s.talk.video) return;
    open(s.talk, { at: s.at, mode: s.mode, pos: s.pos, autoplay: !!s.playing });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resume); else resume();
})();
