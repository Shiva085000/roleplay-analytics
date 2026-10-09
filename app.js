/* Roleplay Analytics front end. Talks to the local backend (server.py). */
(function () {
  "use strict";

  const IST_MS = 330 * 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: keep defaults */ } },
  };
  const state = {
    api: store.get("rpa.api", "http://localhost:8765"),
    key: store.get("rpa.key", ""),
    preset: store.get("rpa.preset", "yesterday"),
    unit: store.get("rpa.unit", "auto"),
    compare: store.get("rpa.compare", "prev"),
    charts: {},
    status: null,
  };

  // ---- time helpers (all in IST, independent of the viewer's timezone) ----
  const nowIst = () => new Date(Date.now() + IST_MS); // fields read with getUTC* are IST wall time
  const pad = (n) => String(n).padStart(2, "0");
  const fmtLocal = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const parseLocal = (s) => new Date(s + ":00Z"); // IST wall time held in a UTC Date
  const addMs = (d, ms) => new Date(d.getTime() + ms);
  const H = 3600e3, D = 24 * H;
  const floorHour = (d) => { const x = new Date(d); x.setUTCMinutes(0, 0, 0); return x; };
  const floorDay = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
  const human = (d) => d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  function presetWindow(p) {
    const now = nowIst();
    const nextHour = addMs(floorHour(now), H); // include the hour in progress
    switch (p) {
      case "h1": return [addMs(nextHour, -1 * H), nextHour];
      case "h5": return [addMs(nextHour, -5 * H), nextHour];
      case "h24": return [addMs(nextHour, -24 * H), nextHour];
      case "today": return [floorDay(now), addMs(floorDay(now), D)];
      case "yesterday": return [addMs(floorDay(now), -D), floorDay(now)];
      case "week": { const t = floorDay(now); const dow = (t.getUTCDay() + 6) % 7; const s = addMs(t, -dow * D); return [s, addMs(s, 7 * D)]; }
      case "d7": return [addMs(floorDay(now), -6 * D), addMs(floorDay(now), D)];
      case "month": { const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); return [s, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))]; }
      default: return null;
    }
  }

  function autoUnit(lo, hi) {
    const span = hi - lo;
    if (span <= 2 * D) return "hour";
    if (span <= 45 * D) return "day";
    if (span <= 180 * D) return "week";
    return "month";
  }

  function compareWindow(lo, hi) {
    if (state.compare === "prev") return [addMs(lo, -(hi - lo)), lo];
    if (state.compare === "lastweek") return [addMs(lo, -7 * D), addMs(hi, -7 * D)];
    if (state.compare === "custom" && $("cfrom").value && $("cto").value) return [parseLocal($("cfrom").value), parseLocal($("cto").value)];
    return null;
  }

  // ---- backend calls ----
  function url(path, params) {
    const u = new URL(path, state.api.replace(/\/+$/, "") + "/");
    Object.entries(params || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u;
  }
  async function call(path, params, opts = {}) {
    const headers = state.key ? { "X-Access-Key": state.key } : {};
    const res = await fetch(url(path, params), { ...opts, headers });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch { /* not JSON */ }
      throw new Error(`${res.status}: ${msg}`);
    }
    return res;
  }

  function setPill(id, cls, text) {
    const el = $(id);
    el.classList.remove("ok", "bad");
    if (cls) el.classList.add(cls);
    el.querySelector("span:last-child").textContent = text;
  }

  async function refreshStatus() {
    try {
      const s = await (await call("api/status")).json();
      state.status = s;
      setPill("backendPill", "ok", "Backend: connected");
      const cov = s.coverage.map(([a, b]) => `${human(parseLocal(a.slice(0, 16)))} – ${human(parseLocal(b.slice(0, 16)))}`).join("; ");
      setPill("coveragePill", s.coverage.length ? "ok" : "bad", s.coverage.length ? `Logs stored: ${cov}` : "Logs stored: none");
      setPill("livePill", s.live_azure ? "ok" : "bad", s.live_azure ? "Live Azure: connected" : "Live Azure: no access");
      return true;
    } catch (e) {
      state.status = null;
      setPill("backendPill", "bad", "Backend: not reachable");
      setPill("coveragePill", null, "Logs: —");
      setPill("livePill", null, "Live Azure: —");
      showNotice(`Can't reach the backend at ${state.api}. Start it on this PC with "python server.py" in roleplay-analysis (or start_backend.bat), then reload. If Chrome asks to let this site access devices on your local network, choose Allow.`);
      return false;
    }
  }

  // ---- UI state ----
  function press(groupId, attr, value) {
    $(groupId).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
  }
  function applyPreset(p) {
    state.preset = p; store.set("rpa.preset", p);
    press("presets", "p", p);
    const w = presetWindow(p);
    if (w) { $("from").value = fmtLocal(w[0]); $("to").value = fmtLocal(w[1]); }
    updateWindowLine();
  }
  function currentWindow() {
    if (!$("from").value || !$("to").value) return null;
    const lo = parseLocal($("from").value), hi = parseLocal($("to").value);
    return hi > lo ? [lo, hi] : null;
  }
  function updateWindowLine() {
    const w = currentWindow();
    if (!w) { $("windowLine").textContent = "Pick a valid window ('to' after 'from')."; return; }
    const unit = state.unit === "auto" ? autoUnit(...w) : state.unit;
    const c = compareWindow(...w);
    const line = $("windowLine");
    line.replaceChildren();
    const b = (t) => { const e = document.createElement("b"); e.textContent = t; return e; };
    line.append("Showing ", b(`${human(w[0])} → ${human(w[1])} IST`), `, grouped by ${unit}`);
    if (c) line.append(", compared with ", b(`${human(c[0])} → ${human(c[1])}`));
    line.append(".");
  }

  function showNotice(text) { const n = $("notice"); n.textContent = text; n.hidden = !text; }

  // ---- rendering ----
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const fmtInt = (v) => (v == null ? "—" : v.toLocaleString("en-IN"));

  function delta(el, cur, prev, { pp = true, goodUp = true } = {}) {
    el.classList.remove("up", "down");
    if (cur == null || prev == null) { el.textContent = ""; return; }
    const d = cur - prev;
    const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
    el.textContent = pp ? `${sign}${Math.abs(d).toFixed(1)} pp vs ${fmtPct(prev)}` : `${sign}${Math.abs(d).toLocaleString("en-IN")} vs ${fmtInt(prev)}`;
    if (Math.abs(d) >= 0.05) el.classList.add((d > 0) === goodUp ? "up" : "down");
  }

  function chart(id, config) {
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart($(id), config);
  }
  function baseOptions(extra = {}) {
    const ink2 = css("--ink-2"), grid = css("--grid");
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: ink2, boxWidth: 12, boxHeight: 12 } }, tooltip: { enabled: true } },
      scales: {
        x: { ticks: { color: ink2, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { color: css("--axis") } },
        y: { ticks: { color: ink2 }, grid: { color: grid }, border: { display: false }, beginAtZero: true },
      },
      ...extra,
    };
  }
  function bucketLabel(iso, unit) {
    const d = parseLocal(iso.slice(0, 16));
    if (unit === "hour") return d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", hour12: false }) + ":00";
    if (unit === "month") return d.toLocaleString("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });
    const s = d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
    return unit === "week" ? `Week of ${s}` : s;
  }

  function render(res) {
    const cur = res.current, cmp = res.compare;
    const accent = css("--accent"), compareCol = css("--compare");
    $("k-sessions").textContent = fmtInt(cur.sessions);
    $("k-success").textContent = fmtPct(cur.success_pct);
    $("k-never").textContent = fmtPct(cur.themes["Never heard"].pct);
    $("k-stopped").textContent = fmtPct(cur.themes["Heard, then stopped"].pct);
    $("k-notsaved").textContent = fmtPct(cur.themes["Not saved"].pct);
    $("k-conn").textContent = fmtPct(cur.themes["Never connected"].pct);
    delta($("d-sessions"), cur.sessions, cmp?.sessions, { pp: false });
    delta($("d-success"), cur.success_pct, cmp?.success_pct);
    if (res.change) $("d-success").textContent += ` (±${res.change.ci95_pp} pp is noise)`;
    delta($("d-never"), cur.themes["Never heard"].pct, cmp?.themes["Never heard"].pct, { goodUp: false });
    delta($("d-stopped"), cur.themes["Heard, then stopped"].pct, cmp?.themes["Heard, then stopped"].pct, { goodUp: false });
    delta($("d-notsaved"), cur.themes["Not saved"].pct, cmp?.themes["Not saved"].pct, { goodUp: false });
    delta($("d-conn"), cur.themes["Never connected"].pct, cmp?.themes["Never connected"].pct, { goodUp: false });

    const unit = res.window.unit;
    const labels = cur.trend.map((t) => bucketLabel(t.start, unit));
    const trendSets = [{ label: "Completion %", data: cur.trend.map((t) => t.success_pct), borderColor: accent, backgroundColor: accent, borderWidth: 2, pointRadius: 3, tension: 0 }];
    if (cmp && cmp.success_pct != null) {
      trendSets.push({ label: `Comparison average (${fmtPct(cmp.success_pct)})`, data: labels.map(() => cmp.success_pct), borderColor: compareCol, backgroundColor: compareCol, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 });
    }
    chart("trendChart", { type: "line", data: { labels, datasets: trendSets },
      options: baseOptions({ scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, max: 100, ticks: { color: css("--ink-2"), callback: (v) => v + "%" } } },
        plugins: { ...baseOptions().plugins, legend: { display: trendSets.length > 1, labels: { color: css("--ink-2"), boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}`, afterBody: (items) => { const t = cur.trend[items[0].dataIndex]; return t ? `${fmtInt(t.successful)} of ${fmtInt(t.sessions)} sessions` : ""; } } } } }) });

    chart("volumeChart", { type: "bar", data: { labels, datasets: [{ label: "Sessions", data: cur.trend.map((t) => t.sessions), backgroundColor: accent, borderRadius: 4, maxBarThickness: 32 }] },
      options: baseOptions({ plugins: { legend: { display: false } } }) });

    const fsets = [{ label: "Selected window", data: cur.funnel.map((f) => f.pct), backgroundColor: accent, borderRadius: 4, maxBarThickness: 22 }];
    if (cmp) fsets.push({ label: "Comparison", data: cmp.funnel.map((f) => f.pct), backgroundColor: compareCol, borderRadius: 4, maxBarThickness: 22 });
    chart("funnelChart", { type: "bar", data: { labels: cur.funnel.map((f) => f.step), datasets: fsets },
      options: baseOptions({ indexAxis: "y", interaction: { mode: "index", intersect: false },
        scales: { x: { min: 0, max: 100, ticks: { color: css("--ink-2"), callback: (v) => v + "%" }, grid: { color: css("--grid") }, border: { display: false } },
          y: { ticks: { color: css("--ink") }, grid: { display: false }, border: { color: css("--axis") } } },
        plugins: { legend: { display: !!cmp, labels: { color: css("--ink-2"), boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.x)}` } } } }) });

    const fails = cur.categories.filter((c) => c.category !== "Successful");
    const cmpPct = Object.fromEntries((cmp?.categories || []).map((c) => [c.category, c.pct]));
    const csets = [{ label: "Selected window", data: fails.map((c) => c.pct), backgroundColor: accent, borderRadius: 4, maxBarThickness: 16 }];
    if (cmp) csets.push({ label: "Comparison", data: fails.map((c) => cmpPct[c.category] ?? 0), backgroundColor: compareCol, borderRadius: 4, maxBarThickness: 16 });
    chart("catChart", { type: "bar", data: { labels: fails.map((c) => c.category), datasets: csets },
      options: baseOptions({ indexAxis: "y",
        scales: { x: { beginAtZero: true, ticks: { color: css("--ink-2"), callback: (v) => v + "%" }, grid: { color: css("--grid") }, border: { display: false } },
          y: { ticks: { color: css("--ink"), autoSkip: false, font: { size: 11 } }, grid: { display: false }, border: { color: css("--axis") } } },
        plugins: { legend: { display: !!cmp, labels: { color: css("--ink-2"), boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.x)}` } } } }) });

    table("catTable", ["Category", "Group", "Sessions", "% of sessions", cmp ? "% comparison" : null, "% of failures", "Evidence"].filter(Boolean),
      fails.map((c) => [c.category, c.theme, fmtInt(c.n), fmtPct(c.pct), cmp ? fmtPct(cmpPct[c.category] ?? 0) : null, fmtPct(c.share_of_failures), EVIDENCE[c.category] || ""].filter((x, i) => cmp || i !== 4)), { ev: true });
    const cw = Object.fromEntries((cmp?.warnings || []).map((w) => [w.warning, w]));
    table("warnTable", ["First warning", "% of sessions", "Heard after", "Completed", cmp ? "Completed (comparison)" : null].filter(Boolean),
      cur.warnings.map((w) => [w.warning, fmtPct(w.share), w.heard_after_pct == null ? "—" : fmtPct(w.heard_after_pct), fmtPct(w.success_pct), cmp ? fmtPct(cw[w.warning]?.success_pct) : null].filter((x, i) => cmp || i !== 4)));
    const cl = Object.fromEntries((cmp?.languages || []).map((w) => [w.key, w]));
    table("langTable", ["Language", "Sessions", "% of sessions", "Completed", cmp ? "Completed (comparison)" : null].filter(Boolean),
      cur.languages.map((l) => [l.key, fmtInt(l.n), fmtPct(l.share), fmtPct(l.success_pct), cmp ? fmtPct(cl[l.key]?.success_pct) : null].filter((x, i) => cmp || i !== 4)));
    const cd = Object.fromEntries((cmp?.devices || []).map((w) => [w.key, w]));
    table("devTable", ["Device / browser", "Sessions", "% of sessions", "Completed", cmp ? "Completed (comparison)" : null].filter(Boolean),
      cur.devices.map((l) => [l.key, fmtInt(l.n), fmtPct(l.share), fmtPct(l.success_pct), cmp ? fmtPct(cd[l.key]?.success_pct) : null].filter((x, i) => cmp || i !== 4)));
  }

  function table(id, head, rows, opts = {}) {
    const t = $(id);
    t.replaceChildren();
    const thead = t.createTHead().insertRow();
    head.forEach((h, i) => { const th = document.createElement("th"); th.textContent = h; if (i === 0 || (opts.ev && i === head.length - 1) || h === "Group") th.className = "t"; thead.appendChild(th); });
    const body = t.createTBody();
    if (!rows.length) { const r = body.insertRow(); const c = r.insertCell(); c.colSpan = head.length; c.className = "empty"; c.textContent = "No sessions in this window."; return; }
    rows.forEach((r) => {
      const tr = body.insertRow();
      r.forEach((v, i) => {
        const td = tr.insertCell();
        td.textContent = v;
        if (opts.ev && i === r.length - 1) td.className = "ev";
        else if (i === 0 || head[i] === "Group") td.className = "t";
      });
    });
  }

  const EVIDENCE = {};

  // ---- actions ----
  async function analyse() {
    const w = currentWindow();
    if (!w) return;
    if (!state.status && !(await refreshStatus())) return;
    const unit = state.unit === "auto" ? autoUnit(...w) : state.unit;
    const c = compareWindow(...w);
    const params = { from: fmtLocal(w[0]), to: fmtLocal(w[1]), unit };
    if (c) { params.compare_from = fmtLocal(c[0]); params.compare_to = fmtLocal(c[1]); }
    const btn = $("runBtn");
    btn.disabled = true; btn.textContent = "Analysing…";
    showNotice("");
    try {
      const res = await (await call("api/analysis", params)).json();
      Object.assign(EVIDENCE, res.evidence || {});
      render(res);
      const gaps = [...res.window.missing, ...(res.compare_window?.missing || [])];
      if (gaps.length) {
        const g = gaps.map(([a, b]) => `${human(parseLocal(a.slice(0, 16)))} – ${human(parseLocal(b.slice(0, 16)))}`).join("; ");
        showNotice(`No logs are stored for ${g} IST, so those hours show no sessions. ` +
          (state.status?.live_azure ? "Live Azure fetch did not return them." :
            "Drop the newer log export into Downloads and press “Load new exports”, or give this PC's Azure login Log Analytics Reader access for live data."));
      } else if (!res.current.sessions) {
        showNotice("No roleplay sessions started in this window.");
      }
    } catch (e) {
      showNotice(`Analysis failed: ${e.message}`);
    } finally {
      btn.disabled = false; btn.textContent = "Analyse";
    }
  }

  async function downloadExcel() {
    const w = currentWindow();
    if (!w) return;
    const btn = $("excelBtn");
    btn.disabled = true; btn.textContent = "Preparing Excel…";
    try {
      const res = await call("api/export.xlsx", { from: fmtLocal(w[0]), to: fmtLocal(w[1]) });
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename\*=utf-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
      const name = m ? decodeURIComponent(m[1]) : "roleplay-sessions.xlsx";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      showNotice(`Excel export failed: ${e.message}`);
    } finally {
      btn.disabled = false; btn.textContent = "Download Excel";
    }
  }

  async function ingest() {
    const btn = $("ingestBtn");
    btn.disabled = true; btn.textContent = "Loading…";
    try {
      const r = await (await call("api/ingest", null, { method: "POST" })).json();
      await refreshStatus();
      showNotice(r.loaded.length ? `Loaded ${r.loaded.join(", ")}.` : "No new exports found in Downloads or data/raw.");
    } catch (e) {
      showNotice(`Loading exports failed: ${e.message}`);
    } finally {
      btn.disabled = false; btn.textContent = "Load new exports";
    }
  }

  // ---- wire up ----
  $("presets").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) applyPreset(b.dataset.p); });
  $("units").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.unit = b.dataset.u; store.set("rpa.unit", state.unit); press("units", "u", state.unit); updateWindowLine(); });
  $("compares").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.compare = b.dataset.c; store.set("rpa.compare", state.compare); press("compares", "c", state.compare);
    $("compareInputs").hidden = state.compare !== "custom"; updateWindowLine();
  });
  ["from", "to"].forEach((id) => $(id).addEventListener("change", () => { state.preset = "custom"; press("presets", "p", "custom"); updateWindowLine(); }));
  ["cfrom", "cto"].forEach((id) => $(id).addEventListener("change", updateWindowLine));
  $("runBtn").addEventListener("click", analyse);
  $("excelBtn").addEventListener("click", downloadExcel);
  $("ingestBtn").addEventListener("click", ingest);
  $("settingsBtn").addEventListener("click", () => { $("apiBase").value = state.api; $("apiKey").value = state.key; $("settings").showModal(); });
  $("settings").addEventListener("close", async () => {
    if ($("settings").returnValue !== "save") return;
    state.api = $("apiBase").value.trim() || "http://localhost:8765"; state.key = $("apiKey").value;
    store.set("rpa.api", state.api); store.set("rpa.key", state.key);
    state.status = null; showNotice(""); await refreshStatus();
  });

  press("units", "u", state.unit);
  press("compares", "c", state.compare);
  $("compareInputs").hidden = state.compare !== "custom";
  applyPreset(state.preset === "custom" ? "yesterday" : state.preset);
  refreshStatus().then((ok) => ok && analyse());
})();
