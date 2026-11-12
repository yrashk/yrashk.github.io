// The top-bar clock of his two homes, shared by the desktop (index.html) and every reader page
// (templates/article.html), served at /clock.js.
//
// Homes come from atlas.json: person.homes → places with a time zone (window.ATLAS on the desktop; the
// build passes the same list to reader pages). The city he is in now (person.here) carries a thin signal
// underline: pages style `.city.here`. Offsets come from Intl: when the two match, one time and both
// names; when they differ (BC stays on daylight time), both clocks, or just the times when space is short.
//
//   const clock = yrClock.start({ clock, zone, box, homes, here });   // clock.here, clock.tick()
//   yrClock.homesFrom(window.ATLAS) · yrClock.at(homes, date) → [{id, n, tz, t, z, off}]
(function () {
  const FALLBACK = [
    { id: "redwood-city", n: "Redwood City", tz: "America/Los_Angeles" },
    { id: "comox", n: "Comox", tz: "America/Vancouver" },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const time = (tz, n) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" }).format(n);
  const zoneName = (tz, n, style) => (new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: style }).formatToParts(n).find((p) => p.type === "timeZoneName") || {}).value || "";

  function homesFrom(atlas) {
    const person = (atlas && atlas.person) || {}, places = (atlas && atlas.places) || [];
    const homes = (person.homes || []).map((id) => places.find((p) => p.id === id)).filter((p) => p && p.tz).map((p) => ({ id: p.id, n: p.name.split(",")[0], tz: p.tz }));
    return homes.length ? homes : FALLBACK;
  }
  function at(homes, n = new Date()) {
    return homes.map((h) => ({ ...h, t: time(h.tz, n), z: zoneName(h.tz, n, "short"), off: zoneName(h.tz, n, "shortOffset").replace("GMT", "UTC") }));
  }
  // → {clock, zone} as HTML
  function render(homes, here, n = new Date(), short = false) {
    const h = at(homes, n), [a, b] = h;
    const mk = (x, txt) => `<i class="city${here && here.id === x.id ? " here" : ""}">${esc(txt)}</i>`;
    if (!b || a.t === b.t) return { clock: here ? mk(here, a.t) : esc(a.t), zone: `${esc(a.z)} · ${h.map((x) => mk(x, x.n)).join(" · ")}` };
    if (short) return { clock: `${mk(a, a.t)} · ${mk(b, b.t)}`, zone: `${mk(a, a.n)} / ${mk(b, b.n)}` };
    return { clock: `${mk(a, a.n)} ${a.t} · ${mk(b, b.n)} ${b.t}`, zone: `${esc(a.z)} / ${esc(b.z)}` };
  }
  function start({ clock, zone, box, homes = FALLBACK, here = null, short = () => innerWidth < 1100, every = 1000 }) {
    const H = homes.find((h) => h.id === here) || null;
    const tick = () => {
      try {
        const r = render(homes, H, new Date(), short());
        if (clock) clock.innerHTML = r.clock;
        if (zone) zone.innerHTML = r.zone;
        if (box && H) { box.title = `currently in ${H.n}`; box.setAttribute("aria-label", `local time · currently in ${H.n}`); }
      } catch (e) { console.warn("clock:", e); }
    };
    tick();
    setInterval(tick, every);
    addEventListener("resize", tick);
    return { here: H, homes, tick };
  }
  window.yrClock = { homesFrom, at, render, start };
})();
