(() => {
  "use strict";
  const { $, h, toast, api, LABEL, ymd, today, fmtDate, daysUntil, field, questionForm, accuracy, questionTable, logout } = SAT;
  const STATUSES = ["New", "Active", "Paused", "Done"];
  const TYPING = "textarea, input:not([type=checkbox]):not([type=radio])";
  const S = { students: new Map(), prep: {}, features: {}, loaded: false, selected: null,
    cal: { status: "loading", events: [], at: null, error: "" }, openBrief: new Set(), busy: {}, prefill: null, detailDirty: false, upDirty: false, qFilter: "all" };

  /* ---------- data shape ---------- */
  function shape(v) {
    const p = v.profile || {};
    return { ...p, ...v, scores: p.scores || {}, goals: p.goals || [], focus: p.focus || [], days: p.days || [],
      allQuestions: [...(v.studentQuestions || []), ...(v.questions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at)) };
  }
  const put = (v) => { const st = shape(v); S.students.set(st.id, st); return st; };
  const norm = (s) => String(s || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const total = (s) => (s && s.rw && s.math ? s.rw + s.math : null);
  const latestScore = (st) => { const ps = (st.sessions || []).filter((x) => x.score).sort((a, b) => (a.date < b.date ? -1 : 1)); return ps.length ? ps[ps.length - 1].score : total(st.scores); };
  const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const planOf = (st) => (st.plan && Array.isArray(st.plan.steps) ? st.plan : { summary: "", steps: [] });
  const currentStep = (st) => { const p = planOf(st); const i = p.steps.findIndex((s) => !s.done); return i < 0 ? null : { i, step: p.steps[i] }; };
  const newId = () => Math.random().toString(36).slice(2, 10);
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  /* ---------- server calls ---------- */
  async function op(body, quiet) {
    try { const r = await api("/api/tutor", { body }); if (r.student) put(r.student); if (r.prep) S.prep = r.prep; return r; }
    catch (e) { if (!quiet) toast(e.message); throw e; }
  }
  const saveTutor = (id, patch) => op({ op: "tutor", id, patch }).then(() => renderAll());

  /* ---------- calendar ---------- */
  function studentFor(ev) {
    const k = norm(ev.name);
    for (const st of S.students.values()) if (norm(st.name) === k || (st.calNames || []).some((n) => norm(n) === k)) return st;
    return null;
  }
  const eventsFor = (st) => S.cal.events.filter((ev) => studentFor(ev) === st);
  async function loadCalendar(manual) {
    const b = $("#syncBtn"); if (manual) { b.disabled = true; b.textContent = "Syncing…"; }
    try {
      const r = await api("/api/calendar");
      if (!r.configured) S.cal = { status: "nocal", events: [], at: null, error: "" };
      else S.cal = { status: "ok", events: r.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end), mins: Math.round((e.end - e.start) / 60000) })), at: r.at, error: "" };
      if (manual) toast("Calendar synced");
    } catch (e) { S.cal = { ...S.cal, status: S.cal.events.length ? "stale" : "error", error: e.message }; }
    finally { b.disabled = false; b.textContent = "Sync now"; renderAll(); }
  }

  /* ---------- AI ---------- */
  async function draftPrep(ev) {
    const st = studentFor(ev); if (!st) return;
    S.openBrief.add(ev.id); S.busy[ev.id] = true; renderUpcoming(); renderDetail();
    try { const r = await api("/api/ai", { body: { kind: "prep", id: st.id, eventId: ev.id, start: ev.start.getTime(), mins: ev.mins } }); S.prep = r.prep; }
    catch (e) { toast(e.message); }
    finally { delete S.busy[ev.id]; renderUpcoming(); renderDetail(); }
  }
  async function draftPlan(st, btn, msg) {
    btn.disabled = true; msg.textContent = "Drafting a plan… this can take up to a minute.";
    try { await api("/api/ai", { body: { kind: "plan", id: st.id } }); const r = await api("/api/tutor"); load(r); msg.textContent = ""; }
    catch (e) { msg.textContent = e.message; btn.disabled = false; }
  }
  function briefNodes(text) {
    const out = []; let buf = [];
    const flush = () => { if (buf.length) { out.push(h("p", { text: buf.join("\n") })); buf = []; } };
    for (const line of String(text).split("\n")) { const t = line.trim(); if (/^[A-Z][A-Z &]{3,}$/.test(t)) { flush(); out.push(h("h4", { text: t })); } else if (t || buf.length) buf.push(line.replace(/\*\*/g, "")); }
    flush(); return out;
  }

  /* ---------- render: summary + upcoming ---------- */
  function renderSummary() {
    const all = [...S.students.values()];
    const now = new Date(), wk = new Date(now.getTime() + 7 * 86400e3);
    const week = S.cal.events.filter((e) => e.end >= now && e.start <= wk);
    const unprepped = week.filter((e) => !S.prep[e.id]?.prepared).length;
    const ym = today().slice(0, 7); let mins = 0, earned = 0;
    for (const s of all) for (const x of s.sessions || []) if ((x.date || "").startsWith(ym)) { mins += Number(x.mins) || 0; earned += ((Number(x.mins) || 0) / 60) * (Number(s.rate) || 0); }
    const weekAgo = ymd(new Date(Date.now() - 7 * 86400e3));
    const qWeek = all.reduce((t, s) => t + s.allQuestions.filter((q) => q.date >= weekAgo).length, 0);
    const tile = (v, l, alert) => h("div", { class: "tile" + (alert ? " alert" : "") }, h("div", { class: "v", text: v }), h("div", { class: "l", text: l }));
    $("#tiles").replaceChildren(
      tile(week.length, "sessions in the next 7 days"),
      tile(unprepped, unprepped ? "of those not prepped yet" : "all prepped", unprepped > 0),
      tile(qWeek, "questions logged this week"),
      tile((mins / 60).toFixed(mins % 60 ? 1 : 0), "hours logged this month"),
      ...(earned > 0 ? [tile(money(earned), "earned this month")] : []));
  }
  function prepToggle(ev) {
    const on = !!S.prep[ev.id]?.prepared;
    const inp = h("input", { type: "checkbox", checked: on, "aria-label": `Prepared for ${ev.name} on ${fmtDay(ev.start)}`, onchange: async (e) => {
      S.prep[ev.id] = { ...(S.prep[ev.id] || {}), prepared: e.target.checked }; renderUpcoming(); renderSummary(); renderDetail();
      try { await op({ op: "prep", eventId: ev.id, prepared: e.target.checked }); } catch { S.prep[ev.id].prepared = !e.target.checked; renderAll(); }
    } });
    return h("label", { class: "prepchk" + (on ? " on" : "") }, inp, h("span", { class: "o", "aria-hidden": "true" }), on ? "Prepared" : "Not prepped");
  }
  function briefBlock(ev) {
    const st = studentFor(ev), p = S.prep[ev.id] || {}, busy = S.busy[ev.id];
    const box = h("div", { class: "brief-box" });
    if (busy) box.append(h("p", { class: "muted", text: "Writing the prep brief… this takes up to a minute." }));
    else if (p.aiPrep) box.append(h("div", {}, briefNodes(p.aiPrep)), h("p", { class: "stamp", text: "AI prep brief · drafted " + ago(p.aiPrepAt) }));
    else box.append(h("p", { class: "muted small", text: st ? "No prep brief yet. It uses this student's course plan, goals, question log, notes and recent sessions." : "Add this student to your roster first." }));
    if (st && S.features.ai) box.append(h("div", { class: "actions" },
      h("button", { type: "button", class: "btn small ai", disabled: busy, text: busy ? "Writing…" : p.aiPrep ? "Redraft brief" : "Draft prep brief with AI", onclick: () => draftPrep(ev) }),
      !planOf(st).steps.length ? h("span", { class: "muted small", text: "Tip: make a course plan first for a sharper brief." }) : null));
    if (st && !S.features.ai) box.append(h("p", { class: "muted small", text: "Tick “Prepared” once you’re ready. Ask Claude for a prep brief any time." }));
    return box;
  }
  function sessRow(ev, opts = {}) {
    const st = studentFor(ev), on = !!S.prep[ev.id]?.prepared, c = st && currentStep(st), open = S.openBrief.has(ev.id);
    const who = h("div", { class: "who" },
      st ? h("button", { type: "button", text: st.name, onclick: () => { S.selected = st.id; renderList(); renderDetail(); $("#detail").scrollIntoView({ behavior: "smooth", block: "start" }); } }) : h("span", { style: "font-weight:700", text: ev.name }),
      h("span", { class: "meta" }, `${ev.mins} min`, c ? ` · plan step ${c.i + 1}: ${c.step.title}` : "", st ? "" : " · not on your roster"));
    const ctl = h("div", { class: "ctl" },
      !st ? h("button", { type: "button", class: "btn small", text: "Add to students", onclick: () => op({ op: "addStudent", name: ev.name, calNames: [ev.name] }).then((r) => { S.selected = r.student.id; renderAll(); }) }) : null,
      opts.past ? null : prepToggle(ev),
      opts.past && st ? h("button", { type: "button", class: "btn small primary", text: "Log it", onclick: () => logFromEvent(ev) }) : null,
      !opts.past ? h("button", { type: "button", class: "btn small", "aria-expanded": String(open), text: open ? "Hide prep" : "Prep brief", onclick: () => { open ? S.openBrief.delete(ev.id) : S.openBrief.add(ev.id); renderUpcoming(); renderDetail(); } }) : null);
    const row = h("div", { class: "sess" + (on || opts.past ? " ok" : "") }, h("span", { class: "time", text: opts.showDay ? `${fmtDay(ev.start)} ${fmtTime(ev.start)}` : `${fmtTime(ev.start)}–${fmtTime(ev.end)}` }), who, ctl);
    if (open && !opts.past) row.append(h("div", { class: "brief" }, briefBlock(ev)));
    return row;
  }
  function syncLine() {
    const el = $("#syncLine"); el.className = "sync"; el.replaceChildren(h("span", { class: "dotc" }));
    const c = S.cal;
    if (c.status === "ok") el.append(`From your Tutoring calendar · updated ${ago(c.at)}`);
    else if (c.status === "stale") { el.classList.add("stale"); el.append(`Showing the last sync. ${c.error}`); }
    else if (c.status === "loading") el.append("Reading your calendar…");
    else if (c.status === "nocal") { el.classList.add("bad"); el.append("Calendar not connected yet: add GCAL_ICS_URL in Vercel."); }
    else { el.classList.add("bad"); el.append(c.error || "Couldn't read the calendar."); }
    $("#syncBtn").hidden = c.status === "nocal";
  }
  function renderUpcoming() {
    if ($("#upBody").contains(document.activeElement) && document.activeElement.matches(TYPING)) { S.upDirty = true; return; }
    S.upDirty = false; syncLine();
    const body = $("#upBody"); body.replaceChildren();
    if (S.cal.status === "loading") { body.append(h("p", { class: "muted", text: "Loading sessions…" })); return; }
    const now = new Date(), horizon = new Date(now.getTime() + 14 * 86400e3);
    const up = S.cal.events.filter((e) => e.end >= now && e.start <= horizon);
    const later = S.cal.events.filter((e) => e.start > horizon).length;
    const past = S.cal.events.filter((e) => e.end < now).filter((e) => { const st = studentFor(e); return st && !(st.sessions || []).some((x) => x.calEventId === e.id); });
    if (!up.length && S.cal.status === "ok") body.append(h("p", { class: "muted", text: "No sessions titled “SAT - Name” in the next two weeks." }));
    let day = "", group = null;
    for (const ev of up) {
      const k = ymd(ev.start);
      if (k !== day) { day = k; group = h("div", {}, h("div", { class: "daylabel", text: (k === today() ? "Today · " : "") + fmtDay(ev.start) })); body.append(group); }
      group.append(sessRow(ev));
    }
    if (later) body.append(h("p", { class: "muted small", text: `${later} more session${later > 1 ? "s" : ""} after the next two weeks.` }));
    if (past.length) { const g = h("div", {}, h("div", { class: "daylabel", text: "Finished, not logged yet" })); past.slice(-6).reverse().forEach((ev) => g.append(sessRow(ev, { past: true, showDay: true }))); body.append(g); }
  }

  /* ---------- render: roster ---------- */
  function filtered() {
    const q = $("#q").value.trim().toLowerCase(), f = $("#statusFilter").value;
    const nextOf = (st) => { const e = eventsFor(st).find((e) => e.end >= new Date()); return e ? e.start.getTime() : Infinity; };
    return [...S.students.values()].filter((s) => {
      if (f === "open" && !(s.status === "New" || s.status === "Active")) return false;
      if (STATUSES.includes(f) && s.status !== f) return false;
      if (q && !`${s.name} ${s.school || ""} ${(s.goals || []).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => nextOf(a) - nextOf(b) || a.name.localeCompare(b.name));
  }
  function renderList() {
    const list = $("#list"); list.replaceChildren();
    if (!S.loaded) { list.append(h("div", { class: "status-msg", text: "Loading your students…" })); return; }
    const rows = filtered();
    if (!S.students.size) { list.append(h("div", { class: "empty" }, h("h3", { text: "No students yet" }), h("p", { class: "muted", text: "Students appear here when they log in with their name, when you add them, or from calendar sessions named “SAT - Name”." }))); return; }
    if (!rows.length) { list.append(h("div", { class: "status-msg", text: "No students match this filter." })); return; }
    if (!S.selected || !S.students.has(S.selected)) S.selected = rows[0].id;
    for (const s of rows) {
      const d = daysUntil(s.testDate), cur = latestScore(s), nx = eventsFor(s).find((e) => e.end >= new Date());
      const meta = [];
      if (nx) meta.push(h("span", { text: "next " + fmtDay(nx.start) }));
      if (d != null && d >= 0) meta.push(h("span", { class: d <= 14 ? "soon" : "", text: `test in ${d}d` }));
      if (cur && s.target) meta.push(h("span", { class: "num", text: s.target > cur ? `+${s.target - cur} to go` : "at target" }));
      meta.push(h("span", { text: `${s.allQuestions.length} question${s.allQuestions.length === 1 ? "" : "s"}` }));
      if (!planOf(s).steps.length) meta.push(h("span", { text: "no plan" }));
      list.append(h("button", { type: "button", class: "row", role: "option", "aria-selected": String(s.id === S.selected), onclick: () => { S.selected = s.id; renderList(); renderDetail(); } },
        h("span", { class: "t" }, h("span", { text: s.name }), h("span", { class: "pill " + s.status, text: s.status })), h("span", { class: "m" }, meta)));
    }
  }
  function sparkline(st) {
    const pts = (st.sessions || []).filter((x) => x.score).sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ v: x.score }));
    const base = total(st.scores); if (base) pts.unshift({ v: base });
    if (pts.length < 2) return h("p", { class: "muted small", text: "Add practice scores when you log sessions to see progress here." });
    const W = 320, H = 90, P = 8, L = 34;
    const vals = pts.map((p) => p.v).concat(st.target ? [st.target] : []);
    const lo = Math.max(400, Math.floor((Math.min(...vals) - 30) / 50) * 50), hi = Math.min(1600, Math.ceil((Math.max(...vals) + 30) / 50) * 50);
    const x = (i) => L + (W - L - P) * (i / (pts.length - 1)), y = (v) => P + (H - 2 * P) * (1 - (v - lo) / (hi - lo || 1));
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", "100%"); svg.setAttribute("style", "max-width:420px");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Scores from ${pts[0].v} to ${pts[pts.length - 1].v}`);
    const add = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
    [lo, hi].forEach((v) => { add("line", { x1: L, x2: W - P, y1: y(v), y2: y(v), stroke: "var(--line)" }); add("text", { x: 0, y: y(v) + 4 }).textContent = v; });
    if (st.target && st.target <= hi) add("line", { x1: L, x2: W - P, y1: y(st.target), y2: y(st.target), stroke: "var(--mark)", "stroke-dasharray": "4 3", "stroke-width": 2 });
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    add("path", { d: d + `L${x(pts.length - 1)},${H - P}L${L},${H - P}Z`, fill: "var(--accent)", opacity: ".1" });
    add("path", { d, fill: "none", stroke: "var(--accent)", "stroke-width": 2 });
    add("circle", { cx: x(pts.length - 1), cy: y(pts[pts.length - 1].v), r: 4, fill: "var(--accent)" });
    return h("div", {}, svg, h("p", { class: "muted", style: "font-size:12px" }, `Latest ${pts[pts.length - 1].v}`, st.target ? ` · dashed line is target ${st.target}` : ""));
  }

  /* ---------- render: student detail ---------- */
  function planCard(st) {
    const id = st.id, p = planOf(st), c = currentStep(st);
    const latest = () => planOf(S.students.get(id) || st);   // always edit the newest saved plan
    const setPlan = (np) => saveTutor(id, { plan: np });
    const msg = h("span", { class: "muted small", "aria-live": "polite" });
    let armed = false;
    const aiBtn = h("button", { type: "button", class: "btn small ai", text: p.steps.length ? "Redraft with AI" : "Draft a plan with AI", onclick: (e) => {
      if (p.steps.length && !armed) { armed = true; e.target.textContent = "Replaces the steps below. Click again"; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = "Redraft with AI"; }, 5000); return; }
      draftPlan(st, e.target, msg);
    } });
    const sum = h("textarea", { id: "pl_sum", rows: "2", value: p.summary || "", placeholder: "Overall strategy, e.g. Math first: Advanced Math and data questions, then grammar rules; full test every 3 weeks" });
    sum.addEventListener("change", (e) => setPlan({ ...latest(), summary: e.target.value }));
    const steps = h("div", { class: "steps" });
    p.steps.forEach((s, i) => {
      const upd = (patch) => ({ ...latest(), steps: latest().steps.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) });
      const t = h("input", { type: "text", id: "pt_" + s.id, value: s.title, "aria-label": `Step ${i + 1} title` }); t.addEventListener("change", (e) => setPlan(upd({ title: e.target.value })));
      const f = h("input", { type: "text", id: "pf_" + s.id, value: s.focus || "", placeholder: "What to cover", "aria-label": `Step ${i + 1} focus` }); f.addEventListener("change", (e) => setPlan(upd({ focus: e.target.value })));
      steps.append(h("div", { class: "step" + (s.done ? " done" : "") + (c && c.i === i ? " current" : "") },
        h("span", { class: "k", text: i + 1 }), h("div", { class: "fs" }, t, f),
        h("div", { class: "side" },
          h("input", { type: "checkbox", class: "chk", "aria-label": `Step ${i + 1} done`, checked: !!s.done, onchange: (e) => setPlan(upd({ done: e.target.checked })) }),
          h("button", { type: "button", class: "btn small danger", "aria-label": `Remove step ${i + 1}`, text: "×", onclick: () => setPlan({ ...latest(), steps: latest().steps.filter((x) => x.id !== s.id) }) }))));
    });
    return h("div", { class: "card private" },
      h("div", { class: "head" }, h("h3", { text: "Course plan" }), h("span", { class: "lock", text: "PRIVATE" }), h("span", { style: "flex:1" }), S.features.ai ? aiBtn : null),
      msg, field("Strategy", sum),
      p.steps.length ? h("p", { class: "muted small" }, c ? `On step ${c.i + 1} of ${p.steps.length}. Tick a step when it's done; prep briefs follow the current step.` : "Every step is done.") : h("p", { class: "muted small", text: S.features.ai ? "No steps yet. Draft one with AI from this student's profile and question log, or add steps yourself." : "No steps yet. Paste a plan or add steps yourself." }),
      steps,
      h("div", { class: "actions" },
      h("button", { type: "button", class: "btn small", text: "Paste a plan", onclick: () => openPastePlan(st) }),
      h("button", { type: "button", class: "btn small", text: "Add step", onclick: () => { const L = latest(); setPlan({ ...L, steps: [...L.steps, { id: newId(), title: `Week ${L.steps.length + 1}: `, focus: "", done: false }] }); } })));
  }
  /** Paste a plan written elsewhere (for example, drafted with Claude). */
  function parsePlan(text) {
    let summary = ""; const steps = [];
    for (const raw of String(text).split("\n")) {
      const line = raw.trim().replace(/^[-*•]\s*/, ""); if (!line) continue;
      const sm = line.match(/^(strategy|summary|goal)\s*:\s*(.+)$/i); if (sm) { summary = sm[2].trim(); continue; }
      const parts = line.split(/\s+\|\s+|\s+[—–]\s+/);
      const title = parts.shift().trim(), focus = parts.join(" — ").trim();
      if (title) steps.push({ id: newId(), title: title.slice(0, 140), focus: focus.slice(0, 500), done: false });
    }
    return { summary, steps };
  }
  function openPastePlan(st) {
    const ta = h("textarea", { id: "pp_text", rows: "12", placeholder: "Strategy: Math first, then grammar\nWeek 1: Linear equations | Slope, systems, Desmos checks\nWeek 2: Bluebook test 2 | Full test, review misses" });
    const L = planOf(S.students.get(st.id) || st);
    modal(`Paste a plan for ${st.name}`, h("div", { class: "grid" },
      h("p", { class: "muted small", text: "One step per line. Put the focus after a | or a dash. An optional first line starting with “Strategy:” becomes the summary." }),
      L.steps.length ? h("p", { class: "callout small", text: `This replaces the ${L.steps.length} step${L.steps.length > 1 ? "s" : ""} already in the plan.` }) : null, ta), async () => {
      const p = parsePlan(ta.value);
      if (!p.steps.length) throw new Error("No steps found. Put one step on each line.");
      await op({ op: "tutor", id: st.id, patch: { plan: { summary: p.summary || L.summary || "", steps: p.steps } } }, true);
      renderAll(); toast(`Plan saved: ${p.steps.length} steps`);
    }, "Save plan");
  }

  function questionsCard(st) {
    const sel = h("select", { id: "tq_filter", "aria-label": "Show", style: "width:auto", onchange: (e) => { S.qFilter = e.target.value; renderDetail(); } },
      [["all", "All"], ["miss", "Missed or guessed"], ["student", "Logged by student"], ["tutor", "Logged by you"], ["RW", "Reading & Writing"], ["Math", "Math"]].map(([v, l]) => h("option", { value: v, text: l })));
    sel.value = S.qFilter;
    const f = S.qFilter;
    const list = st.allQuestions.filter((q) => f === "all" || (f === "miss" ? q.result !== "right" : f === "student" || f === "tutor" ? q.by === f : q.section === f));
    const details = h("details", {}, h("summary", { class: "btn small", style: "display:inline-flex", text: "Log a question for this student" }),
      h("div", { style: "margin-top:12px" }, questionForm("tq", (q) => op({ op: "addQuestion", id: st.id, question: q }).then(() => { renderDetail(); renderSummary(); renderList(); }))));
    return h("div", { class: "card" },
      h("div", { class: "head" }, h("h3", { text: "Question log" }), h("span", { class: "muted small", text: `${st.allQuestions.length} total · ${st.allQuestions.filter((q) => q.by === "student").length} from the student` }), h("span", { style: "flex:1" }), sel),
      accuracy(st.allQuestions), details,
      questionTable(list.slice(0, 300), { showBy: true, canDelete: () => true,
        onDelete: (q) => op({ op: "deleteQuestion", id: st.id, qid: q.id }).then(() => { renderDetail(); renderSummary(); toast("Deleted"); }) }));
  }
  function logFromEvent(ev) {
    const st = studentFor(ev); if (!st) return;
    S.selected = st.id; S.prefill = { date: ymd(ev.start), mins: ev.mins, calEventId: ev.id, topics: currentStep(st)?.step.title || "" };
    renderList(); renderDetail();
    const t = $("#n_topics"); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.focus(); }
  }
  function renderDetail() {
    const box = $("#detail");
    if (box.contains(document.activeElement) && document.activeElement.matches(TYPING)) { S.detailDirty = true; return; }
    S.detailDirty = false; box.replaceChildren();
    const st = S.selected && S.students.get(S.selected);
    if (!S.loaded || !st) return;
    const id = st.id, cur = total(st.scores), d = daysUntil(st.testDate);
    const statusSel = h("select", { id: "d_status", "aria-label": "Status", style: "width:auto", onchange: (e) => saveTutor(id, { status: e.target.value }) }, STATUSES.map((s) => h("option", { value: s, text: s })));
    statusSel.value = st.status || "New";
    let armed = false;
    const del = h("button", { type: "button", class: "btn small danger", text: "Delete", onclick: async (e) => {
      if (!armed) { armed = true; e.target.textContent = "Click again to delete"; setTimeout(() => { armed = false; if (e.target.isConnected) e.target.textContent = "Delete"; }, 4000); return; }
      try { await op({ op: "deleteStudent", id }); S.students.delete(id); S.selected = null; renderAll(); toast("Student deleted"); } catch {}
    } });
    box.append(h("div", { class: "card" },
      h("div", { class: "dhead" },
        h("div", { class: "whois" }, h("h2", { text: st.name }), h("p", { class: "muted" }, [st.grade && `${st.grade} grade`, st.school, st.contact].filter(Boolean).join(" · ") || "No profile details yet")),
        h("button", { type: "button", class: "btn small", text: "Edit profile", onclick: () => openStudentModal(S.students.get(id) || st) }), statusSel, del),
      h("div", { class: "facts" },
        h("div", { class: "fact" }, h("div", { class: "l", text: "Starting score" }), h("div", { class: "v", text: cur ?? "—" }), cur ? h("div", { class: "l", text: `R&W ${st.scores.rw} · Math ${st.scores.math}` }) : null),
        h("div", { class: "fact" }, h("div", { class: "l", text: "Target" }), h("div", { class: "v", text: st.target ?? "—" })),
        h("div", { class: "fact" }, h("div", { class: "l", text: "Latest" }), h("div", { class: "v", text: latestScore(st) ?? "—" })),
        h("div", { class: "fact" }, h("div", { class: "l", text: "Test date" }), h("div", { class: "v", style: "font-size:15px", text: st.testDate ? fmtDate(st.testDate) : "—" }), d != null && d >= 0 ? h("div", { class: "l " + (d <= 14 ? "soon" : ""), text: `${d} days away` }) : null))));

    const gc = h("div", { class: "card" }, h("h3", { text: "What they want to learn" }));
    gc.append(st.goals.length ? h("ol", { class: "goals-list" }, st.goals.map((g) => h("li", { text: g }))) : h("p", { class: "muted", text: "No goals yet. They can fill these in after logging in, or use Edit profile to add what's on their Varsity Tutors profile." }));
    if (st.focus.length) gc.append(h("div", { class: "tags" }, st.focus.map((k) => h("span", { class: "tag", text: LABEL[k] }))));
    if (st.hardest) gc.append(h("p", {}, h("b", { text: "Hardest so far: " }), st.hardest));
    if (st.extra) gc.append(h("p", {}, h("b", { text: "Also: " }), st.extra));
    if (st.days.length || st.times) gc.append(h("p", {}, h("b", { text: "Free: " }), [st.days.join(", "), st.times].filter(Boolean).join(" · ")));
    box.append(gc);

    box.append(planCard(st));
    box.append(questionsCard(st));

    const mine = eventsFor(st).filter((e) => e.end >= new Date());
    const uc = h("div", { class: "card" }, h("div", { class: "head" }, h("h3", { text: "Upcoming sessions" }), h("span", { class: "muted small", text: "from Google Calendar" })));
    if (!mine.length) uc.append(h("p", { class: "muted small", text: S.cal.status === "ok" ? `Nothing on the calendar. Title an event “SAT - ${st.name}” on your Tutoring calendar to see it here.` : "Waiting for the calendar." }));
    mine.slice(0, 6).forEach((ev) => uc.append(sessRow(ev, { showDay: true })));
    box.append(uc);

    const notes = h("textarea", { id: "d_notes", rows: "4", value: st.notes || "", placeholder: "Observations, what to try next, parent notes…" });
    notes.addEventListener("change", (e) => saveTutor(id, { notes: e.target.value }));
    const rate = h("input", { type: "number", id: "d_rate", min: "0", step: "1", inputmode: "decimal", value: st.rate ?? "" });
    rate.addEventListener("change", (e) => saveTutor(id, { rate: e.target.value === "" ? null : Number(e.target.value) }));
    box.append(h("div", { class: "card private" },
      h("div", { class: "head" }, h("h3", { text: "Your notes" }), h("span", { class: "lock", text: "PRIVATE" })),
      field("Notes", notes), h("div", { class: "grid g2" }, field(h("span", {}, "Your hourly pay ($) ", h("span", { class: "hint", text: "for the earnings tile" })), rate)),
      h("div", {}, h("h3", { style: "margin-bottom:6px", text: "Score progress" }), sparkline(st))));

    const sessions = [...(st.sessions || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    const after = () => { renderDetail(); renderUpcoming(); renderSummary(); };
    const tbl = h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Min", "Covered", "Homework", "HW done", "Score", ""].map((t, i) => h("th", { class: i === 1 || i === 5 ? "num" : "", text: t })))));
    const tb = h("tbody");
    if (!sessions.length) tb.append(h("tr", {}, h("td", { colspan: "7", class: "muted", text: "No sessions logged yet." })));
    for (const x of sessions) {
      tb.append(h("tr", {},
        h("td", { text: fmtDate(x.date) }), h("td", { class: "num", text: x.mins || "" }), h("td", { text: x.topics || "" }), h("td", { text: x.homework || "" }),
        h("td", {}, h("input", { type: "checkbox", class: "chk", "aria-label": "Homework done", checked: !!x.hwDone, onchange: (e) => op({ op: "sessionHw", id, sid: x.id, hwDone: e.target.checked }).then(after) })),
        h("td", { class: "num", text: x.score || "" }),
        h("td", {}, h("button", { type: "button", class: "btn small danger", "aria-label": "Remove session", text: "×", onclick: () => op({ op: "deleteSession", id, sid: x.id }).then(after) }))));
    }
    tbl.append(tb);
    const pf = S.prefill && S.selected === id ? S.prefill : null;
    const f = { date: h("input", { type: "date", id: "n_date", value: pf?.date || today() }), mins: h("input", { type: "number", id: "n_mins", value: String(pf?.mins ?? 60), min: "0", step: "15" }),
      topics: h("input", { type: "text", id: "n_topics", value: pf?.topics || "", placeholder: "e.g. linear equations, transitions" }), homework: h("input", { type: "text", id: "n_hw", placeholder: "e.g. Bluebook test 3, module 1" }),
      score: h("input", { type: "number", id: "n_score", min: "400", max: "1600", step: "10", placeholder: "optional" }) };
    const addForm = h("form", { class: "grid", onsubmit: (e) => {
      e.preventDefault();
      if (f.score.value && !(Number(f.score.value) >= 400 && Number(f.score.value) <= 1600)) { toast("Practice score should be 400–1600."); return; }
      const session = { date: f.date.value, mins: f.mins.value, topics: f.topics.value, homework: f.homework.value, score: f.score.value, calEventId: pf?.calEventId };
      S.prefill = null; document.activeElement?.blur();
      op({ op: "addSession", id, session }).then(() => { after(); toast("Session logged"); }).catch(() => {});
    } },
      pf ? h("p", { class: "callout small" }, `Logging the ${fmtDate(pf.date)} calendar session.`) : null,
      h("div", { class: "grid g3" }, field("Date", f.date), field("Minutes", f.mins), field("Practice score", f.score)),
      h("div", { class: "grid g2" }, field("What you covered", f.topics), field("Homework", f.homework)),
      h("button", { type: "submit", class: "btn primary", style: "justify-self:start", text: "Log session" }));
    box.append(h("div", { class: "card private" },
      h("div", { class: "head" }, h("h3", { text: "Session log" }), h("span", { class: "lock", text: "PRIVATE" })),
      h("div", { class: "table-wrap" }, tbl), h("h3", { text: "Log a session" }), addForm));
  }
  document.addEventListener("focusout", () => setTimeout(() => {
    if (S.detailDirty && !$("#detail").contains(document.activeElement)) renderDetail();
    if (S.upDirty && !$("#upBody").contains(document.activeElement)) renderUpcoming();
  }, 0));
  function renderAll() { renderSummary(); renderUpcoming(); renderList(); renderDetail(); }

  /* ---------- modal ---------- */
  function modal(title, body, onOk, okText) {
    const root = $("#modalRoot"); const close = () => root.replaceChildren();
    const err = h("p", { class: "err", role: "alert" });
    const m = h("div", { class: "modal-back", onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      h("form", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, onsubmit: async (e) => { e.preventDefault(); try { if ((await onOk()) !== false) close(); } catch (x) { err.textContent = x.message; } } },
        h("h2", { text: title }), body, err,
        h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: okText }), h("button", { type: "button", class: "btn", text: "Cancel", onclick: close }))));
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    root.replaceChildren(m); m.querySelector("input,textarea")?.focus();
  }
  function openStudentModal(st) {
    const v = st || { scores: {}, goals: [], focus: [], calNames: [] };
    const inp = (id, val, extra = {}) => h("input", { type: "text", id, value: val ?? "", ...extra });
    const i = { name: inp("m_name", v.name), grade: inp("m_grade", v.grade), school: inp("m_school", v.school), contact: inp("m_contact", v.contact),
      test: h("input", { type: "date", id: "m_test", value: v.testDate || "" }),
      rw: h("input", { type: "number", id: "m_rw", value: v.scores?.rw ?? "", min: "200", max: "800", step: "10" }), math: h("input", { type: "number", id: "m_math", value: v.scores?.math ?? "", min: "200", max: "800", step: "10" }),
      src: inp("m_src", v.scores?.source, { placeholder: "e.g. PSAT, Bluebook test 1" }),
      target: h("input", { type: "number", id: "m_target", value: v.target ?? "", min: "400", max: "1600", step: "10" }),
      goals: h("textarea", { id: "m_goals", rows: "3", value: (v.goals || []).join("\n"), placeholder: "One per line" }),
      hard: h("textarea", { id: "m_hard", rows: "2", value: v.hardest || "" }),
      extra: h("textarea", { id: "m_extra", rows: "3", value: v.extra || "", placeholder: "Anything from their Varsity Tutors profile: accommodations, learning style, parent notes" }),
      cal: inp("m_cal", (v.calNames || []).join(", "), { placeholder: "e.g. Riley Z." }) };
    const focusBox = h("div", { class: "tags" }, Object.entries(LABEL).map(([k, l]) => h("label", { class: "tag", style: "cursor:pointer" }, h("input", { type: "checkbox", name: "m_focus", value: k, checked: (v.focus || []).includes(k), style: "margin-right:6px" }), l)));
    modal(st ? "Edit profile" : "Add student", h("div", { class: "grid" },
      h("div", { class: "grid g2" }, field("Name", i.name), field("Grade", i.grade), field("School", i.school), field("Contact", i.contact), field("Test date", i.test),
        field(h("span", {}, "Calendar name ", h("span", { class: "hint", text: "as written after “SAT - ”" })), i.cal)),
      h("div", { class: "grid g3" }, field("R&W score", i.rw), field("Math score", i.math), field("Score from", i.src), field("Target", i.target)),
      field(h("span", {}, "Main learnings ", h("span", { class: "hint", text: "one per line, up to 3" })), i.goals),
      h("div", { class: "grid", style: "gap:6px" }, h("span", { style: "font-weight:600;font-size:13px", text: "Areas to work on" }), focusBox),
      field("Hardest so far", i.hard), field("Other notes", i.extra)), async () => {
      if (!i.name.value.trim()) throw new Error("Add a name.");
      const profile = { ...(st ? st.profile : {}), grade: i.grade.value, school: i.school.value, contact: i.contact.value, testDate: i.test.value,
        scores: { rw: i.rw.value, math: i.math.value, source: i.src.value }, target: i.target.value,
        goals: i.goals.value.split("\n").map((s) => s.trim()).filter(Boolean),
        focus: [...document.querySelectorAll("input[name=m_focus]:checked")].map((x) => x.value), hardest: i.hard.value, extra: i.extra.value };
      const calNames = i.cal.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (st) await op({ op: "profile", id: st.id, name: i.name.value, profile, calNames }, true);
      else { const r = await op({ op: "addStudent", name: i.name.value, profile, calNames: calNames.length ? calNames : [i.name.value.trim()] }, true); S.selected = r.student.id; }
      renderAll();
    }, st ? "Save" : "Add student");
  }

  /* ---------- boot ---------- */
  function load(r) { S.students = new Map(); r.students.forEach(put); S.prep = r.prep || {}; S.features = r.features || {}; S.loaded = true; renderAll(); }
  async function boot() {
    $("#logout").onclick = logout;
    $("#syncBtn").onclick = () => loadCalendar(true);
    $("#q").addEventListener("input", renderList);
    $("#statusFilter").addEventListener("change", () => { renderList(); renderDetail(); });
    $("#addBtn").onclick = () => openStudentModal(null);
    renderAll();
    try { const me = await api("/api/login"); if (me.role !== "tutor") { location.href = "/"; return; } $("#who").textContent = me.name; } catch { return; }
    try { load(await api("/api/tutor")); } catch (e) { $("#list").replaceChildren(h("div", { class: "status-msg", text: e.message })); }
    loadCalendar(false);
    setInterval(() => { if (!document.hidden) loadCalendar(false); }, 10 * 60 * 1000);
    setInterval(async () => { if (document.hidden || $("#modalRoot").childElementCount) return; try { const r = await api("/api/tutor"); const keep = S.selected; load(r); S.selected = keep; } catch {} }, 2 * 60 * 1000);
  }
  boot();
})();
