// Shared browser helpers for every page.
window.SAT = (() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
    return e;
  }
  let toastT;
  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = h("div", { id: "toast", class: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400);
  }
  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
    if (opts.body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let r;
    try { r = await fetch(path, init); } catch { throw new Error("Can't reach the server. Check your internet connection."); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !opts.allow401) { location.href = "/"; throw new Error(j.error || "Please log in."); }
    if (!r.ok) throw Object.assign(new Error(j.error || `Something went wrong (${r.status}).`), { status: r.status });
    return j;
  }
  async function logout() { try { await api("/api/login", { method: "DELETE", allow401: true }); } catch {} location.href = "/"; }

  /* ---------- SAT taxonomy (College Board content domains and skills) ---------- */
  const CATEGORIES = {
    info: { section: "RW", name: "Information and Ideas", skills: ["Central Ideas and Details", "Command of Evidence: Textual", "Command of Evidence: Quantitative", "Inferences"] },
    craft: { section: "RW", name: "Craft and Structure", skills: ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"] },
    expr: { section: "RW", name: "Expression of Ideas", skills: ["Rhetorical Synthesis", "Transitions"] },
    conv: { section: "RW", name: "Standard English Conventions", skills: ["Boundaries", "Form, Structure, and Sense"] },
    alg: { section: "Math", name: "Algebra", skills: ["Linear equations in one variable", "Linear functions", "Linear equations in two variables", "Systems of two linear equations in two variables", "Linear inequalities in one or two variables"] },
    adv: { section: "Math", name: "Advanced Math", skills: ["Nonlinear functions", "Nonlinear equations in one variable and systems of equations in two variables", "Equivalent expressions"] },
    psda: { section: "Math", name: "Problem-Solving and Data Analysis", skills: ["Ratios, rates, proportional relationships, and units", "Percentages", "One-variable data: distributions and measures of center and spread", "Two-variable data: models and scatterplots", "Probability and conditional probability", "Inference from sample statistics and margin of error", "Evaluating statistical claims: observational studies and experiments"] },
    geo: { section: "Math", name: "Geometry and Trigonometry", skills: ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"] },
  };
  const OLD = { info: "info", craft: "craft", expr: "expr", conv: "conv", alg: "alg", adv: "adv", psda: "psda", geo: "geo" };
  const catOf = (q) => q.category || OLD[q.domain] || "";
  const SECTION = { RW: "Reading and Writing", Math: "Math" };
  const KIND = { diagnostic: "Diagnostic", skill: "Skill session", "test-review": "Practice test review", other: "Session" };
  const RESULT = { right: "Right", wrong: "Wrong", guessed: "Guessed", skipped: "Skipped" };

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const daysUntil = (iso) => { if (!iso) return null; const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); };
  const relDay = (ts) => { const a = new Date(ts); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(0, 0, 0, 0); const n = Math.round((a - b) / 86400000); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 1 && n < 7 ? `In ${n} days` : null; };
  const isToday = (ts) => ymd(new Date(ts)) === today();
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const initials = (n) => String(n || "?").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

  /* ---------- sessions ---------- */
  const sessionTitle = (s) => s.title || (s.kind === "skill" && s.skill ? s.skill : KIND[s.kind] || "Session");
  const sessionSub = (s) => [fmtTime(s.start) + (s.end ? "–" + fmtTime(s.end) : ""), s.category ? CATEGORIES[s.category]?.name : null].filter(Boolean).join(" · ");
  function datebox(ts) {
    const d = new Date(ts);
    return h("div", { class: "datebox" + (isToday(ts) ? " today" : "") }, h("span", { text: d.toLocaleDateString(undefined, { month: "short" }) }), h("b", { text: d.getDate() }));
  }
  function splitSessions(list) {
    const now = Date.now();
    return { upcoming: list.filter((s) => (s.end || s.start) >= now).sort((a, b) => a.start - b.start), past: list.filter((s) => (s.end || s.start) < now).sort((a, b) => b.start - a.start) };
  }

  /* ---------- tiny markdown (Granola notes) ---------- */
  function inline(text) {
    const out = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g; let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith("**")) out.push(h("strong", { text: t.slice(2, -2) }));
      else if (t.startsWith("`")) out.push(h("code", { text: t.slice(1, -1) }));
      else { const label = t.slice(1, t.indexOf("]")); out.push(h("a", { href: m[2], target: "_blank", rel: "noopener", text: label })); }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function markdown(src) {
    const root = h("div", { class: "md" }); let list = null, para = [];
    const flushP = () => { if (para.length) { root.append(h("p", {}, inline(para.join("\n")))); para = []; } };
    for (const raw of String(src || "").replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      let m;
      if (!line.trim()) { flushP(); list = null; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); list = null; root.append(h("h" + Math.min(4, m[1].length + 1), {}, inline(m[2]))); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.tagName !== "UL") { list = h("ul"); root.append(list); } list.append(h("li", {}, inline(m[1]))); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.tagName !== "OL") { list = h("ol"); root.append(list); } list.append(h("li", {}, inline(m[1]))); continue; }
      list = null; para.push(line);
    }
    flushP();
    return root;
  }

  /* ---------- form helpers ---------- */
  const field = (label, input, hint) => h("label", { class: "field", for: input.id }, h("span", {}, label, hint ? h("span", { class: "hint", text: " " + hint }) : null), input);
  function categorySelect(id, value, withBlank = true) {
    const sel = h("select", { id }, withBlank ? h("option", { value: "", text: "Choose a category" }) : null,
      ["RW", "Math"].map((sec) => h("optgroup", { label: SECTION[sec] }, Object.entries(CATEGORIES).filter(([, c]) => c.section === sec).map(([k, c]) => h("option", { value: k, text: c.name })))));
    sel.value = value || ""; return sel;
  }
  function skillSelect(id, cat, value) {
    const sel = h("select", { id });
    const fill = (c, v) => { sel.replaceChildren(h("option", { value: "", text: c ? "Choose a skill" : "Pick a category first" }), ...(c ? CATEGORIES[c].skills.map((s) => h("option", { value: s, text: s })) : [])); sel.value = v || ""; sel.disabled = !c; };
    fill(cat, value); sel.refill = fill; return sel;
  }
  function modal(title, body, onOk, okText = "Save", opts = {}) {
    const root = $("#modalRoot") || document.body.appendChild(h("div", { id: "modalRoot" }));
    const close = () => root.replaceChildren();
    const err = h("p", { class: "err", role: "alert" });
    const okBtn = h("button", { type: "submit", class: "btn primary", text: okText });
    const m = h("div", { class: "modal-back", onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      h("form", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, onsubmit: async (e) => {
        e.preventDefault(); okBtn.disabled = true;
        try { if ((await onOk()) !== false) close(); } catch (x) { err.textContent = x.message; } finally { okBtn.disabled = false; }
      } },
        h("div", { class: "card-h" }, h("h2", { text: title }), h("button", { type: "button", class: "btn ghost icon", "aria-label": "Close", text: "✕", onclick: close })),
        h("div", { class: "card-b" }, body, err),
        h("div", { class: "foot" }, h("button", { type: "button", class: "btn", text: "Cancel", onclick: close }), opts.hideOk ? null : okBtn)));
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    root.replaceChildren(m); setTimeout(() => m.querySelector("input:not([type=hidden]),textarea,select")?.focus(), 0);
    return close;
  }

  /* ---------- questions ---------- */
  function questionForm(idp, onSubmit, opts = {}) {
    const id = (k) => `${idp}_${k}`;
    const qid = h("input", { type: "text", id: id("qid"), placeholder: "e.g. 3d5a7f2c", autocomplete: "off" });
    const cat = categorySelect(id("cat"), "");
    const skill = skillSelect(id("skill"), "", "");
    cat.addEventListener("change", () => skill.refill(cat.value, ""));
    const diff = h("select", { id: id("diff") }, h("option", { value: "", text: "—" }), ["Easy", "Medium", "Hard"].map((d) => h("option", { value: d, text: d })));
    const date = h("input", { type: "date", id: id("date"), value: today() });
    const source = h("input", { type: "text", id: id("src"), placeholder: "e.g. Bluebook test 4, Module 2" });
    const note = h("textarea", { id: id("note"), rows: "2", placeholder: "What tripped you up, or what to remember next time", style: "min-height:64px" });
    const result = h("div", { class: "seg result", role: "radiogroup", "aria-label": "Result" },
      Object.entries(RESULT).map(([v, l], i) => h("label", {}, h("input", { type: "radio", name: id("res"), value: v, checked: i === 1 }), h("span", { text: l }))));
    const sess = opts.sessions && opts.sessions.length ? h("select", { id: id("sess") }, h("option", { value: "", text: "Not from a session" }),
      opts.sessions.map((s) => h("option", { value: s.id, text: `${fmtShort(s.start)} · ${sessionTitle(s)}` }))) : null;
    if (sess && opts.sessionId) sess.value = opts.sessionId;
    const btn = h("button", { type: "submit", class: "btn primary", text: "Log question" });
    const form = h("form", { class: "grid2", style: "grid-template-columns:1fr", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      const q = { qid: qid.value, category: cat.value, skill: skill.value, difficulty: diff.value, date: date.value, source: source.value, note: note.value,
        result: form.querySelector(`input[name=${id("res")}]:checked`)?.value || "wrong", sessionId: sess ? sess.value : opts.sessionId };
      try { await onSubmit(q); qid.value = ""; note.value = ""; qid.focus(); toast("Question logged"); }
      catch (err) { toast(err.message); } finally { btn.disabled = false; }
    } },
      h("div", { class: "grid3" }, field("Question ID", qid), field("Difficulty", diff), field("Date", date)),
      h("div", { class: "grid2" }, field("Category", cat), field("Skill", skill)),
      h("div", { class: "grid2" }, h("div", { class: "field" }, h("span", { text: "Result" }), result), field("Source", source)),
      sess ? field("Session", sess) : null,
      field("Notes", note, "optional"),
      h("div", { class: "row" }, btn));
    return form;
  }
  function filterQuestions(list, f) {
    return list.filter((q) => (!f.result || (f.result === "miss" ? q.result !== "right" : q.result === f.result))
      && (!f.section || q.section === f.section) && (!f.category || catOf(q) === f.category)
      && (!f.difficulty || q.difficulty === f.difficulty) && (!f.by || q.by === f.by));
  }
  function questionFilters(f, onChange, opts = {}) {
    const mk = (id, opts2, key) => { const s = h("select", { id, style: "width:auto;height:34px", onchange: (e) => { f[key] = e.target.value; onChange(); } }, opts2.map(([v, l]) => h("option", { value: v, text: l }))); s.value = f[key] || ""; return s; };
    return h("div", { class: "row" },
      mk("f_res", [["miss", "Missed or guessed"], ["", "All results"], ["wrong", "Wrong"], ["guessed", "Guessed"], ["right", "Right"]], "result"),
      mk("f_cat", [["", "All categories"], ...Object.entries(CATEGORIES).map(([k, c]) => [k, c.name])], "category"),
      mk("f_diff", [["", "Any difficulty"], ["Easy", "Easy"], ["Medium", "Medium"], ["Hard", "Hard"]], "difficulty"),
      opts.showBy ? mk("f_by", [["", "Logged by anyone"], ["student", "Logged by student"], ["tutor", "Logged by tutor"]], "by") : null);
  }
  function questionTable(list, { onDelete, canDelete, sessions, showBy, empty } = {}) {
    if (!list.length) return h("div", { class: "empty", text: empty || "No questions match these filters." });
    const sById = new Map((sessions || []).map((s) => [s.id, s]));
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Question ID", "Category / skill", "Difficulty", "Result", "Date", "Notes", showBy ? "By" : null, ""].filter((x) => x !== null).map((t) => h("th", { text: t })))),
      h("tbody", {}, list.map((q) => {
        const c = CATEGORIES[catOf(q)], s = q.sessionId && sById.get(q.sessionId);
        return h("tr", {},
          h("td", {}, q.qid ? h("span", { class: "qid", text: q.qid }) : h("span", { class: "muted", text: "—" })),
          h("td", {}, h("div", { text: q.skill || q.topic || (c ? c.name : SECTION[q.section] || "—") }), h("div", { class: "sub", text: c ? `${c.name} · ${SECTION[c.section]}` : SECTION[q.section] || "" })),
          h("td", {}, q.difficulty ? h("span", { class: "badge " + q.difficulty, text: q.difficulty }) : h("span", { class: "muted", text: "—" })),
          h("td", {}, h("span", { class: "badge " + (q.result === "right" ? "good" : q.result === "guessed" ? "warn" : q.result === "wrong" ? "bad" : ""), text: RESULT[q.result] || q.result })),
          h("td", { class: "mono xs", text: fmtDate(q.date) }),
          h("td", { style: "max-width:280px" }, q.note ? h("div", { class: "small", text: q.note }) : null, q.source ? h("div", { class: "sub", text: q.source }) : null, s ? h("div", { class: "sub", text: "Session: " + fmtShort(s.start) }) : null),
          showBy ? h("td", { class: "xs muted", text: q.by === "tutor" ? "Tutor" : "Student" }) : null,
          h("td", {}, canDelete && canDelete(q) ? h("button", { type: "button", class: "btn ghost icon sm danger", "aria-label": "Delete question", text: "✕", onclick: () => onDelete(q) }) : null));
      }))));
  }
  /** Accuracy per skill, weakest first. */
  function skillStats(list) {
    const by = new Map();
    for (const q of list) {
      const c = catOf(q); const key = q.skill ? `${c}|${q.skill}` : c ? `${c}|` : null; if (!key) continue;
      const v = by.get(key) || { cat: c, skill: q.skill || "", n: 0, right: 0, miss: 0 }; v.n++; if (q.result === "right") v.right++; else v.miss++; by.set(key, v);
    }
    return [...by.values()].map((v) => ({ ...v, pct: Math.round((v.right / v.n) * 100) })).sort((a, b) => a.pct - b.pct || b.miss - a.miss);
  }
  function skillBars(list, limit = 8) {
    const stats = skillStats(list).slice(0, limit);
    if (!stats.length) return h("div", { class: "empty", style: "padding:4px 0", text: "Log questions with a category and skill to see weak spots here." });
    return h("div", { class: "bars" }, stats.map((v) => h("div", { class: "bar" + (v.pct < 60 ? " weak" : "") },
      h("div", {}, h("div", { style: "font-weight:600", text: v.skill || CATEGORIES[v.cat]?.name || "—" }), h("div", { class: "xs muted", text: v.skill ? CATEGORIES[v.cat]?.name : "Category" })),
      h("div", { class: "track", role: "img", "aria-label": `${v.pct}% right` }, h("i", { style: `width:${Math.max(3, v.pct)}%` })),
      h("div", { class: "num", text: `${v.right}/${v.n} · ${v.pct}%` }))));
  }

  /* ---------- scores ---------- */
  const scoreTotal = (s) => s.total || (s.rw && s.math ? s.rw + s.math : null);
  function scoreChart(scores, target) {
    const pts = scores.filter((s) => scoreTotal(s)).sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1).map((s) => ({ v: scoreTotal(s), d: s.date }));
    if (pts.length < 2) return null;
    const W = 520, H = 150, P = 14, L = 40, B = 22;
    const vals = pts.map((p) => p.v).concat(target ? [target] : []);
    const lo = Math.max(400, Math.floor((Math.min(...vals) - 40) / 100) * 100), hi = Math.min(1600, Math.ceil((Math.max(...vals) + 40) / 100) * 100);
    const x = (i) => L + (W - L - P) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)), y = (v) => P + (H - P - B) * (1 - (v - lo) / (hi - lo || 1));
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", "100%"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Total scores from ${pts[0].v} to ${pts.at(-1).v}`);
    const add = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
    for (let v = lo; v <= hi; v += (hi - lo) / 2) { add("line", { x1: L, x2: W - P, y1: y(v), y2: y(v), stroke: "var(--line-2)" }); add("text", { x: 0, y: y(v) + 4 }).textContent = Math.round(v); }
    if (target && target >= lo && target <= hi) { add("line", { x1: L, x2: W - P, y1: y(target), y2: y(target), stroke: "var(--accent)", "stroke-dasharray": "5 4", "stroke-width": 1.5 }); add("text", { x: W - P, y: y(target) - 5, "text-anchor": "end" }).textContent = `Target ${target}`; }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    add("path", { d: d + `L${x(pts.length - 1)},${H - B}L${L},${H - B}Z`, fill: "var(--brand)", opacity: ".08" });
    add("path", { d, fill: "none", stroke: "var(--brand)", "stroke-width": 2 });
    pts.forEach((p, i) => add("circle", { cx: x(i), cy: y(p.v), r: i === pts.length - 1 ? 4.5 : 3, fill: "var(--brand)" }));
    add("text", { x: L, y: H - 4 }).textContent = pts[0].d ? fmtDate(pts[0].d) : "";
    add("text", { x: W - P, y: H - 4, "text-anchor": "end" }).textContent = pts.at(-1).d ? fmtDate(pts.at(-1).d) : "";
    return svg;
  }
  function scoreList(scores, { onDelete, canDelete }) {
    const list = [...scores].sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
    if (!list.length) return h("div", { class: "empty", style: "padding:6px 0", text: "No scores yet." });
    return h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Test", "R&W", "Math", "Total", ""].map((t) => h("th", { text: t })))),
      h("tbody", {}, list.map((s) => h("tr", {},
        h("td", {}, h("div", { style: "font-weight:600", text: s.type }), h("div", { class: "sub", text: s.date ? fmtDate(s.date) : "" })),
        h("td", { class: "num mono", text: s.rw ?? "—" }), h("td", { class: "num mono", text: s.math ?? "—" }), h("td", { class: "num mono", style: "font-weight:700", text: scoreTotal(s) ?? "—" }),
        h("td", {}, canDelete(s) ? h("button", { type: "button", class: "btn ghost icon sm danger", "aria-label": "Delete score", text: "✕", onclick: () => onDelete(s) }) : null))))));
  }
  function openScoreModal(onSave) {
    const type = h("select", { id: "sc_type" }, ["Official SAT", "PSAT", "Bluebook practice test", "Other practice test", "Diagnostic"].map((t) => h("option", { value: t, text: t })));
    const date = h("input", { type: "date", id: "sc_date", value: today() });
    const rw = h("input", { type: "number", id: "sc_rw", min: "200", max: "800", step: "10", inputmode: "numeric" });
    const math = h("input", { type: "number", id: "sc_math", min: "200", max: "800", step: "10", inputmode: "numeric" });
    modal("Add a score", h("div", { class: "grid2", style: "grid-template-columns:1fr" },
      h("div", { class: "grid2" }, field("Test", type), field("Date", date)),
      h("div", { class: "grid2" }, field("Reading and Writing", rw, "200–800"), field("Math", math, "200–800"))), async () => {
      const ok = (v, lo, hi) => !v || (Number(v) >= lo && Number(v) <= hi);
      if (!rw.value && !math.value) throw new Error("Add at least one section score.");
      if (!ok(rw.value, 200, 800) || !ok(math.value, 200, 800)) throw new Error("Section scores go from 200 to 800.");
      await onSave({ type: type.value, date: date.value, rw: rw.value, math: math.value });
    }, "Add score");
  }

  /* ---------- goals ---------- */
  function goalsCard(goals, onSave, opts = {}) {
    const list = h("div", {});
    const draw = () => {
      list.replaceChildren(...(goals.length ? goals.map((g) => h("div", { class: "goal" + (g.done ? " done" : "") },
        h("input", { type: "checkbox", checked: g.done, "aria-label": `Done: ${g.text}`, onchange: (e) => { g.done = e.target.checked; onSave(goals); draw(); } }),
        h("span", { class: "t", text: g.text }),
        h("button", { type: "button", class: "btn ghost icon sm", "aria-label": "Remove goal", text: "✕", onclick: () => { goals = goals.filter((x) => x !== g); onSave(goals); draw(); } })))
        : [h("p", { class: "muted small", text: opts.empty || "No goals yet. Add one if you'd like." })]));
    };
    draw();
    const input = h("input", { type: "text", id: opts.id || "goal_new", placeholder: "Add a goal, e.g. Finish Math module 2 on time", "aria-label": "New goal" });
    const form = h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; goals = [...goals, { id: Math.random().toString(36).slice(2, 9), text: t, done: false }]; input.value = ""; onSave(goals); draw(); } },
      h("div", { class: "grow" }, input), h("button", { type: "submit", class: "btn", text: "Add" }));
    return h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: opts.title || "Goals" }), opts.badge ? h("span", { class: "xs muted", text: opts.badge }) : null),
      h("div", { class: "card-b" }, list, form));
  }

  return { $, h, toast, api, logout, CATEGORIES, SECTION, KIND, RESULT, catOf, ymd, today, fmtDate, fmtDay, fmtShort, fmtTime, daysUntil, relDay, isToday, ago, initials,
    sessionTitle, sessionSub, datebox, splitSessions, markdown, field, categorySelect, skillSelect, modal,
    questionForm, filterQuestions, questionFilters, questionTable, skillStats, skillBars, scoreTotal, scoreChart, scoreList, openScoreModal, goalsCard };
})();
