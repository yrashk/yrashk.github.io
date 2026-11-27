// The top-bar clock of his two homes, shared by the desktop (index.html) and every reader page
// (templates/article.html), served at /clock.js.
//
// Homes come from atlas.json: person.homes → places with a time zone (window.ATLAS on the desktop; the
// build passes the same list to reader pages). Where he is now carries a thin signal underline (pages
// style `.city.here`): the current entry of person.stays, else person.here. A stay somewhere that is not
// a home adds that place's clock in front of the homes. Offsets come from Intl: when the two homes match,
// one time and both names; when they differ (BC stays on daylight time), both clocks, or just the times
// when space is short.
//
// person.stays: [{place, from, to?}] with dates in that place's own calendar. The current stay is the
// latest one that has started; its `to` ends it only when the next stay does not pick up the day after
// (so travel days, which straddle time zones, never fall back to person.here). Leave `to` out for open-ended.
//
//   const clock = yrClock.start({ clock, zone, box, homes, here, stays });   // clock.here, clock.tick()
//   yrClock.homesFrom(window.ATLAS) · yrClock.staysFrom(window.ATLAS) · yrClock.stayAt(stays, date)
//   yrClock.at(homes, date) → [{id, n, tz, t, z, off}]
(function () {
  const FALLBACK = [
    { id: "redwood-city", n: "Redwood City", tz: "America/Los_Angeles" },
    { id: "comox", n: "Comox", tz: "America/Vancouver" },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const time = (tz, n) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" }).format(n);
  const day = (tz, n) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(n);
  const nextDay = (d) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
  const zoneName = (tz, n, style) => (new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: style }).formatToParts(n).find((p) => p.type === "timeZoneName") || {}).value || "";
  const placeOf = (atlas, id) => ((atlas && atlas.places) || []).find((p) => p.id === id);

  function homesFrom(atlas) {
    const person = (atlas && atlas.person) || {};
    const homes = (person.homes || []).map((id) => placeOf(atlas, id)).filter((p) => p && p.tz).map((p) => ({ id: p.id, n: p.name.split(",")[0], tz: p.tz }));
    return homes.length ? homes : FALLBACK;
  }
  // person.stays resolved to places with a time zone, in order of arrival
  function staysFrom(atlas) {
    const person = (atlas && atlas.person) || {};
    return (person.stays || [])
      .map((s) => ({ s, p: placeOf(atlas, s.place) }))
      .filter(({ s, p }) => p && p.tz && /^\d{4}-\d{2}-\d{2}$/.test(s.from))
      .map(({ s, p }) => ({ id: p.id, n: p.name.split(",")[0], tz: p.tz, from: s.from, ...(s.to ? { to: s.to } : {}) }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  }
  function stayAt(stays, n = new Date()) {
    let i = -1;
    (stays || []).forEach((s, k) => { if (day(s.tz, n) >= s.from) i = k; });
    if (i < 0) return null;
    const s = stays[i], next = stays[i + 1];
    if (s.to && day(s.tz, n) > s.to && !(next && next.from <= nextDay(s.to))) return null;
    return s;
  }
  function at(homes, n = new Date()) {
    return homes.map((h) => ({ ...h, t: time(h.tz, n), z: zoneName(h.tz, n, "short"), off: zoneName(h.tz, n, "shortOffset").replace("GMT", "UTC") }));
  }
  // → {clock, zone} as HTML; `here` is a home or, away from them, a place {id, n, tz}
  function render(homes, here, n = new Date(), short = false) {
    const h = at(homes, n), [a, b] = h;
    const mk = (x, txt) => `<i class="city${here && here.id === x.id ? " here" : ""}">${esc(txt)}</i>`;
    const away = here && !homes.some((x) => x.id === here.id) ? at([here], n)[0] : null;
    const same = !b || a.t === b.t;
    if (away) {
      if (same && short) return { clock: `${mk(away, away.t)} · ${esc(a.t)}`, zone: `${mk(away, away.n)} / ${h.map((x) => esc(x.n)).join(" · ")}` };
      if (same) return { clock: `${mk(away, away.n)} ${away.t} · ${esc(a.t)}`, zone: `${esc(away.z)} / ${esc(a.z)} · ${h.map((x) => esc(x.n)).join(" · ")}` };
      const all = [away, ...h];
      if (short) return { clock: all.map((x) => mk(x, x.t)).join(" · "), zone: all.map((x) => mk(x, x.n)).join(" / ") };
      return { clock: all.map((x) => `${mk(x, x.n)} ${x.t}`).join(" · "), zone: all.map((x) => esc(x.z)).join(" / ") };
    }
    if (same) return { clock: here ? mk(here, a.t) : esc(a.t), zone: `${esc(a.z)} · ${h.map((x) => mk(x, x.n)).join(" · ")}` };
    if (short) return { clock: `${mk(a, a.t)} · ${mk(b, b.t)}`, zone: `${mk(a, a.n)} / ${mk(b, b.n)}` };
    return { clock: `${mk(a, a.n)} ${a.t} · ${mk(b, b.n)} ${b.t}`, zone: `${esc(a.z)} / ${esc(b.z)}` };
  }
  function start({ clock, zone, box, homes = FALLBACK, here = null, stays = [], short = () => innerWidth < 1100, every = 1000 }) {
    const base = homes.find((h) => h.id === here) || null;
    const where = (n = new Date()) => { const s = stayAt(stays, n); return s ? homes.find((h) => h.id === s.id) || { id: s.id, n: s.n, tz: s.tz } : base; };
    let H = where();
    const tick = () => {
      try {
        const n = new Date();
        H = where(n);
        const r = render(homes, H, n, short());
        if (clock) clock.innerHTML = r.clock;
        if (zone) zone.innerHTML = r.zone;
        if (box && H) { box.title = `currently in ${H.n}`; box.setAttribute("aria-label", `local time · currently in ${H.n}`); }
      } catch (e) { console.warn("clock:", e); }
    };
    tick();
    setInterval(tick, every);
    addEventListener("resize", tick);
    return { get here() { return H; }, homes, tick };
  }
  window.yrClock = { homesFrom, staysFrom, stayAt, at, render, start };
})();
