// Shared browser helpers for all pages.
window.SAT = (() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
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
  const DOMAINS = [
    ["Reading & Writing", "RW", [["info", "Information & Ideas"], ["craft", "Craft & Structure"], ["expr", "Expression of Ideas"], ["conv", "Standard English Conventions"]]],
    ["Math", "Math", [["alg", "Algebra"], ["adv", "Advanced Math"], ["psda", "Problem-Solving & Data Analysis"], ["geo", "Geometry & Trigonometry"]]],
    ["Test skills", null, [["pace", "Pacing and timing"], ["strat", "Strategy and guessing"], ["nerves", "Test anxiety"], ["desmos", "Using the Desmos calculator"]]],
  ];
  const LABEL = Object.fromEntries(DOMAINS.flatMap(([, , items]) => items));
  const RESULT = { right: "Right", wrong: "Wrong", guessed: "Guessed", skipped: "Skipped" };
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  function fmtDate(iso) { if (!iso) return ""; const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  function daysUntil(iso) { if (!iso) return null; const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); }
  const field = (label, input) => h("label", { class: "f", for: input.id }, label, input);

  /** Question entry form. onSubmit(question) must return a promise. */
  function questionForm(idp, onSubmit) {
    const id = (k) => `${idp}_${k}`;
    const sec = h("select", { id: id("sec") }, h("option", { value: "RW", text: "Reading & Writing" }), h("option", { value: "Math", text: "Math" }));
    const dom = h("select", { id: id("dom") });
    const fillDom = () => { const items = DOMAINS.find((d) => d[1] === sec.value)[2]; dom.replaceChildren(h("option", { value: "", text: "Not sure" }), ...items.map(([k, l]) => h("option", { value: k, text: l }))); };
    sec.addEventListener("change", fillDom); fillDom();
    const date = h("input", { type: "date", id: id("date"), value: today() });
    const source = h("input", { type: "text", id: id("src"), placeholder: "e.g. Bluebook test 4, Module 2, Q13" });
    const topic = h("input", { type: "text", id: id("topic"), placeholder: "e.g. systems of equations, transitions" });
    const diff = h("select", { id: id("diff") }, h("option", { value: "", text: "—" }), ["Easy", "Medium", "Hard"].map((d) => h("option", { value: d, text: d })));
    const secs = h("input", { type: "number", id: id("secs"), min: "0", max: "3600", step: "5", placeholder: "optional", inputmode: "numeric" });
    const note = h("textarea", { id: id("note"), rows: "2", placeholder: "What tripped you up, or what to remember next time" });
    const results = h("div", { class: "results", role: "radiogroup", "aria-label": "Result" },
      Object.entries(RESULT).map(([v, l], i) => h("label", {}, h("input", { type: "radio", name: id("res"), value: v, checked: i === 1 }), h("span", { text: l }))));
    const btn = h("button", { type: "submit", class: "btn primary", text: "Log question" });
    const form = h("form", { class: "grid", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      const q = { date: date.value, section: sec.value, domain: dom.value, source: source.value, topic: topic.value, difficulty: diff.value,
        result: form.querySelector(`input[name=${id("res")}]:checked`)?.value || "wrong", seconds: secs.value, note: note.value };
      try { await onSubmit(q); topic.value = ""; note.value = ""; secs.value = ""; topic.focus(); toast("Question logged"); }
      catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    } },
      h("div", { class: "grid g3" }, field("Date", date), field("Section", sec), field("Skill area", dom), field("Difficulty", diff)),
      h("div", { class: "grid g2" }, field("Where it's from", source), field("Topic", topic)),
      h("div", { class: "grid", style: "gap:6px" }, h("span", { style: "font-weight:600;font-size:13px", text: "Result" }), results),
      h("div", { class: "grid g2" }, field("Notes", note), field(h("span", {}, "Seconds spent ", h("span", { class: "hint", text: "optional" })), secs)),
      h("div", { class: "actions" }, btn));
    return form;
  }
  /** Accuracy by skill area. */
  function accuracy(questions) {
    const by = {};
    for (const q of questions) { const k = q.domain || (q.section === "Math" ? "_m" : "_rw"); by[k] = by[k] || { n: 0, r: 0 }; by[k].n++; if (q.result === "right") by[k].r++; }
    const order = ["info", "craft", "expr", "conv", "_rw", "alg", "adv", "psda", "geo", "_m"];
    const rows = order.filter((k) => by[k]).map((k) => {
      const v = by[k], pct = Math.round((v.r / v.n) * 100);
      return h("div", { class: "acc-row" }, h("span", { text: LABEL[k] || (k === "_m" ? "Math (unsorted)" : "R&W (unsorted)") }),
        h("span", { class: "acc-bar", role: "img", "aria-label": `${pct}% right` }, h("i", { style: `width:${pct}%` })),
        h("span", { class: "num", text: `${v.r}/${v.n} · ${pct}%` }));
    });
    return rows.length ? h("div", { class: "acc" }, rows) : h("p", { class: "muted small", text: "No questions logged yet." });
  }
  /** Table of questions. canDelete(q) decides who may remove which. */
  function questionTable(questions, { canDelete, onDelete, showBy }) {
    const t = h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Area", "Topic", "Result", showBy ? "Logged by" : null, ""].filter((x) => x !== null).map((x) => h("th", { text: x })))));
    const tb = h("tbody");
    if (!questions.length) tb.append(h("tr", {}, h("td", { colspan: "6", class: "muted", text: "No questions yet." })));
    for (const q of questions) {
      tb.append(h("tr", {},
        h("td", { text: fmtDate(q.date) }),
        h("td", {}, LABEL[q.domain] || (q.section === "Math" ? "Math" : "Reading & Writing"), q.difficulty ? h("div", { class: "by", text: q.difficulty }) : null),
        h("td", {}, q.topic || "—", q.source ? h("div", { class: "muted small", text: q.source }) : null, q.note ? h("div", { class: "small", text: q.note }) : null),
        h("td", {}, h("span", { class: "res " + q.result, text: RESULT[q.result] || q.result }), q.seconds ? h("div", { class: "by", text: `${q.seconds}s` }) : null),
        showBy ? h("td", { class: "by", text: q.by === "tutor" ? "You" : "Student" }) : null,
        h("td", {}, canDelete(q) ? h("button", { type: "button", class: "btn small danger", "aria-label": "Delete question", text: "×", onclick: () => onDelete(q) }) : null)));
    }
    t.append(tb);
    return h("div", { class: "table-wrap" }, t);
  }
  async function logout() { try { await api("/api/login", { method: "DELETE", allow401: true }); } catch {} location.href = "/"; }
  return { $, h, toast, api, DOMAINS, LABEL, RESULT, ymd, today, fmtDate, daysUntil, field, questionForm, accuracy, questionTable, logout };
})();
