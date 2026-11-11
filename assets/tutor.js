(() => {
  "use strict";
  const { $, h, toast, api, logout, CATEGORIES, KIND, ymd, today, fmtDate, fmtDay, fmtShort, fmtTime, daysUntil, relDay, ago, initials,
    sessionTitle, sessionSub, datebox, splitSessions, markdown, field, categorySelect, skillSelect, modal,
    questionForm, filterQuestions, questionFilters, questionTable, skillStats, skillBars, scoreTotal, scoreChart, scoreList, openScoreModal, goalsCard } = SAT;
  const STATUSES = ["Active", "New", "Paused", "Done"];
  const S = { students: new Map(), cal: {}, unmatched: [], loaded: false, qf: { result: "miss" } };
  const view = () => $("#view");
  const all = () => [...S.students.values()];
  const shape = (v) => ({ ...v, allQuestions: [...(v.studentQuestions || []), ...(v.questions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at)) });

  /* ---------- server ---------- */
  async function load(refresh) {
    const r = await api("/api/tutor" + (refresh ? "?refresh=1" : ""));
    S.students = new Map(r.students.map((v) => [v.id, shape(v)])); S.cal = r.calendar || {}; S.unmatched = r.unmatched || []; S.loaded = true; S.at = Date.now();
  }
  async function op(body) { const r = await api("/api/tutor", { body }); if (r.student) S.students.set(r.student.id, shape(r.student)); return r; }
  const safe = (p) => p.catch((e) => { toast(e.message); throw e; });

  /* ---------- helpers ---------- */
  const latest = (st) => [...(st.scores || [])].filter(scoreTotal).sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1))[0];
  const nextSession = (st) => splitSessions((st.sessions || []).filter((s) => !s.cancelled)).upcoming[0];
  function suggestSkill(st) {
    const covered = new Set((st.sessions || []).filter((s) => s.skill && (s.end || s.start) < Date.now()).map((s) => s.skill));
    return skillStats(st.allQuestions).find((v) => v.skill && !covered.has(v.skill) && v.pct < 100);
  }
  function prepToggle(st, s, after) {
    const on = !!s.prepared;
    return h("label", { class: "prep" + (on ? " on" : ""), style: "position:relative" },
      h("input", { type: "checkbox", checked: on, "aria-label": `Prepared for ${st.name} on ${fmtShort(s.start)}`, onchange: async (e) => {
        try { await op({ op: "session", id: st.id, sessionId: s.id, patch: { prepared: e.target.checked } }); } catch (x) { toast(x.message); }
        (after || render)();
      } }), h("span", { class: "o", "aria-hidden": "true" }), on ? "Prepared" : "Not prepped");
  }
  function sessionRow(st, s, opts = {}) {
    const href = `#session/${st.id}/${encodeURIComponent(s.id)}`;
    const past = (s.end || s.start) < Date.now();
    return h("div", { class: "srow" },
      datebox(s.start),
      h("div", { style: "min-width:0;display:grid;gap:2px" },
        h("a", { href, style: "font-weight:700;text-decoration:none;color:inherit", text: opts.showName ? `${st.name} · ${sessionTitle(s)}` : sessionTitle(s) }),
        h("span", { class: "small muted", text: [relDay(s.start), sessionSub(s), KIND[s.kind]].filter(Boolean).join(" · ") })),
      h("div", { class: "ctl" },
        s.cancelled ? h("span", { class: "badge", text: "Cancelled" }) : null,
        past ? (s.notes ? h("span", { class: "badge good", text: "Notes added" }) : h("span", { class: "badge accent", text: "Needs notes" })) : prepToggle(st, s, opts.after),
        h("a", { class: "btn sm", href, text: past ? "Open" : "Plan" })));
  }

  /* ---------- sidebar ---------- */
  function renderRoster() {
    const q = $("#q").value.trim().toLowerCase();
    const list = all().filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => (a.status === "Done") - (b.status === "Done") || a.name.localeCompare(b.name));
    const cur = location.hash.split("/")[1];
    $("#roster").replaceChildren(...list.map((st) => {
      const n = nextSession(st);
      return h("button", { type: "button", class: "navlink", "aria-current": st.id === cur ? "page" : null, onclick: () => (location.hash = `student/${st.id}`) },
        h("span", { class: "avatar", "aria-hidden": "true", text: initials(st.name) }),
        h("span", { class: "n" }, st.name, st.status !== "Active" ? h("span", { class: "x", text: " · " + st.status }) : null),
        n ? h("span", { class: "x", text: fmtShort(n.start).split(",")[0] }) : null);
    }));
    $("#navHome").setAttribute("aria-current", !location.hash || location.hash === "#home" ? "page" : "false");
  }

  /* ---------- overview ---------- */
  function renderHome() {
    const now = Date.now(), wk = now + 7 * 86400e3;
    const rows = all().flatMap((st) => (st.sessions || []).filter((s) => !s.cancelled).map((s) => ({ st, s })));
    const week = rows.filter(({ s }) => (s.end || s.start) >= now && s.start <= wk).sort((a, b) => a.s.start - b.s.start);
    const later = rows.filter(({ s }) => s.start > wk).length;
    const needNotes = rows.filter(({ s }) => (s.end || s.start) < now && (s.end || s.start) > now - 21 * 86400e3 && !s.notes).sort((a, b) => b.s.start - a.s.start);
    const weekAgo = ymd(new Date(now - 7 * 86400e3));
    const qWeek = all().reduce((t, st) => t + st.allQuestions.filter((q) => q.date >= weekAgo).length, 0);
    const unprepped = week.filter(({ s }) => !s.prepared).length;
    const stat = (v, l, alert) => h("div", { class: "stat" + (alert ? " alert" : "") }, h("div", { class: "v", text: v }), h("div", { class: "l", text: l }));
    const days = h("div", {});
    let day = "", list = null;
    for (const { st, s } of week) {
      const k = ymd(new Date(s.start));
      if (k !== day) { day = k; days.append(h("div", { class: "card-h", style: "padding:10px 20px;background:var(--surface-2)" }, h("span", { class: "eyebrow", text: (relDay(s.start) ? relDay(s.start) + " · " : "") + fmtDay(s.start) }))); list = h("div", { class: "list" }); days.append(list); }
      list.append(sessionRow(st, s, { showName: true }));
    }
    const calLine = S.cal.configured === false ? "Calendar not connected" : S.cal.error ? S.cal.error : S.cal.at ? `Synced from Google Calendar ${ago(S.cal.at)}` : "";
    view().replaceChildren(
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("span", { class: "eyebrow", text: fmtDay(Date.now()) }), h("h1", { text: "Overview" })),
        h("span", { class: "small " + (S.cal.error ? "err" : "muted"), text: calLine }),
        h("button", { type: "button", class: "btn sm", text: "Sync calendar", onclick: async (e) => { e.target.disabled = true; try { await load(true); render(); toast("Calendar synced"); } catch (x) { toast(x.message); } e.target.disabled = false; } })),
      h("div", { class: "stats" }, stat(week.length, "sessions in the next 7 days"), stat(unprepped, unprepped ? "not prepped yet" : "all prepped", unprepped > 0),
        stat(needNotes.length, "recent sessions without notes", needNotes.length > 0), stat(qWeek, "questions logged this week")),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "This week" }), later ? h("span", { class: "small muted", text: `${later} more later` }) : null),
        week.length ? days : h("div", { class: "empty", text: "No sessions in the next 7 days. Sessions come from events titled “SAT - Name” on your Tutoring calendar." })),
      needNotes.length ? h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Add notes" }), h("span", { class: "small muted", text: "Paste your Granola notes so students can see them" })),
        h("div", { class: "list" }, needNotes.slice(0, 8).map(({ st, s }) => sessionRow(st, s, { showName: true })))) : null,
      S.unmatched.length ? h("div", { class: "card" }, h("div", { class: "card-h" }, h("h2", { text: "Calendar names not on your roster" })),
        h("div", { class: "list" }, [...new Map(S.unmatched.map((e) => [e.name, e])).values()].map((e) => h("div", { class: "srow" }, h("span", { class: "avatar", text: initials(e.name) }),
          h("div", {}, h("div", { style: "font-weight:600", text: e.name }), h("div", { class: "small muted", text: "Next: " + fmtShort(e.start) })),
          h("div", { class: "ctl" }, h("button", { type: "button", class: "btn sm", text: "Link to student", onclick: () => openLinkModal(e.name) }),
            h("button", { type: "button", class: "btn sm primary", text: "Add as new", onclick: () => safe(op({ op: "addStudent", name: e.name, calNames: [e.name] })).then(async () => { await load(false); render(); toast("Added " + e.name); }) })))))) : null);
  }
  function openLinkModal(calName) {
    const sel = h("select", { id: "lk_st" }, all().map((s) => h("option", { value: s.id, text: s.name })));
    modal(`Link “${calName}”`, field("This calendar name belongs to", sel), async () => {
      const st = S.students.get(sel.value);
      await op({ op: "profile", id: st.id, calNames: [...new Set([...(st.calNames || []), calName])] });
      await load(false); render(); toast("Linked");
    }, "Link");
  }

  /* ---------- student ---------- */
  function renderStudent(id, tab) {
    const st = S.students.get(id);
    if (!st) { view().replaceChildren(h("div", { class: "card" }, h("div", { class: "card-b" }, h("h2", { text: "Student not found" }), h("a", { href: "#home", text: "Back to overview" })))); return; }
    tab = tab || "overview";
    const p = st.profile || {}, d = daysUntil(p.testDate), lt = latest(st);
    const statusSel = h("select", { id: "st_status", style: "width:auto;height:34px", "aria-label": "Status", onchange: (e) => safe(op({ op: "tutor", id, patch: { status: e.target.value } })).then(render) }, STATUSES.map((s) => h("option", { value: s, text: s })));
    statusSel.value = st.status || "Active";
    const tabs = [["overview", "Overview"], ["sessions", "Sessions"], ["questions", "Questions"], ["plan", "Plan & notes"]];
    const stat = (v, l, alert) => h("div", { class: "stat" + (alert ? " alert" : "") }, h("div", { class: "v", text: v }), h("div", { class: "l", text: l }));
    const misses = st.allQuestions.filter((q) => q.result !== "right").length;
    const body = { overview: studentOverview, sessions: studentSessions, questions: studentQuestions, plan: studentPlan }[tab] || studentOverview;
    view().replaceChildren(
      h("div", { class: "page-head" },
        h("span", { class: "avatar", style: "width:48px;height:48px;font-size:17px", text: initials(st.name) }),
        h("div", { class: "grow" }, h("h1", { text: st.name }), h("p", { class: "muted small", text: [p.grade && `${p.grade} grade`, p.school, p.contact].filter(Boolean).join(" · ") || "No profile details yet" })),
        statusSel, h("button", { type: "button", class: "btn sm", text: "Edit profile", onclick: () => openProfileModal(st) })),
      h("div", { class: "stats" },
        stat(p.testDate ? (d >= 0 ? `${d}d` : "Done") : "—", p.testDate ? `to test day · ${fmtDate(p.testDate)}` : "no test date set", d != null && d >= 0 && d <= 21),
        stat(lt ? scoreTotal(lt) : "—", lt ? `latest · ${lt.type}` : "no scores yet"),
        stat(p.target ?? "—", lt && p.target ? `target · ${Math.max(0, p.target - scoreTotal(lt))} to go` : "target"),
        stat(misses, `missed or guessed · ${st.allQuestions.length} logged`)),
      h("div", { class: "tabs", role: "tablist" }, tabs.map(([k, l]) => h("a", { role: "tab", href: `#student/${id}/${k}`, "aria-selected": String(k === tab), text: l }))),
      body(st));
  }
  function studentOverview(st) {
    const id = st.id, p = st.profile || {};
    const { upcoming, past } = splitSessions((st.sessions || []).filter((s) => !s.cancelled));
    const sug = suggestSkill(st);
    const chart = scoreChart(st.scores || [], p.target);
    return h("div", { class: "cols" },
      h("div", { class: "stack" },
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Upcoming sessions" }), h("button", { type: "button", class: "btn sm", text: "Add session", onclick: () => openAddSession(st) })),
          h("div", { class: "list" }, upcoming.length ? upcoming.slice(0, 4).map((s) => sessionRow(st, s)) : [h("div", { class: "empty", text: `Nothing scheduled. Title an event “SAT - ${st.name}” on your Tutoring calendar, or add a session here.` })])),
        sug ? h("div", { class: "callout" }, h("strong", { text: "Suggested next skill: " }), `${sug.skill} (${CATEGORIES[sug.cat].name}), ${sug.right}/${sug.n} right so far.`) : null,
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Previous sessions" }), h("a", { class: "small", href: `#student/${id}/sessions`, text: "All sessions" })),
          h("div", { class: "list" }, past.length ? past.slice(0, 5).map((s) => sessionRow(st, s)) : [h("div", { class: "empty", text: "No past sessions yet." })])),
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Weakest skills" }), h("a", { class: "small", href: `#student/${id}/questions`, text: "Question log" })), h("div", { class: "card-b" }, skillBars(st.allQuestions, 6)))),
      h("div", { class: "stack" },
        goalsCard((p.goals || []).map((g) => ({ ...g })), (goals) => safe(op({ op: "profile", id, profile: { goals } })), { id: "tg_new", title: "Goals", badge: "Student can edit too", empty: "No goals yet." }),
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Scores" }), h("button", { type: "button", class: "btn sm", text: "Add score", onclick: () => openScoreModal(async (score) => { await op({ op: "addScore", id, score }); render(); toast("Score added"); }) })),
          h("div", { class: "card-b" }, chart, scoreList(st.scores || [], { canDelete: () => true, onDelete: (s) => safe(op({ op: "deleteScore", id, scoreId: s.id })).then(render) }))),
        p.about ? h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "About" })), h("div", { class: "card-b" }, markdown(p.about))) : null));
  }
  function studentSessions(st) {
    const { upcoming, past } = splitSessions(st.sessions || []);
    return h("div", { class: "stack" },
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Upcoming" }), h("button", { type: "button", class: "btn sm", text: "Add session", onclick: () => openAddSession(st) })),
        h("div", { class: "list" }, upcoming.length ? upcoming.map((s) => sessionRow(st, s)) : [h("div", { class: "empty", text: "No upcoming sessions." })])),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Previous" })),
        h("div", { class: "list" }, past.length ? past.map((s) => sessionRow(st, s)) : [h("div", { class: "empty", text: "No past sessions yet." })])));
  }
  function studentQuestions(st) {
    const id = st.id;
    const table = h("div", {});
    const redraw = () => table.replaceChildren(questionTable(filterQuestions(st.allQuestions, S.qf), { sessions: st.sessions, showBy: true, canDelete: () => true,
      onDelete: (q) => safe(op({ op: "deleteQuestion", id, qid: q.id })).then(render) }));
    redraw();
    return h("div", { class: "cols" },
      h("div", { class: "stack" },
        h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Questions they've struggled with" }), h("span", { class: "xs muted", text: `${st.allQuestions.length} logged` })),
          h("div", { class: "card-b", style: "padding-bottom:0" }, questionFilters(S.qf, redraw, { showBy: true })), h("div", { class: "card-b tight" }, table)),
        h("details", { class: "card" }, h("summary", { class: "card-h" }, h("h3", { text: "Log a question for this student" }), h("span", { class: "btn sm", text: "Open" })),
          h("div", { class: "card-b" }, questionForm("tq", async (q) => { await op({ op: "addQuestion", id, question: q }); render(); }, { sessions: st.sessions })))),
      h("div", { class: "stack" }, h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Accuracy by skill" })), h("div", { class: "card-b" }, skillBars(st.allQuestions, 14)))));
  }
  function studentPlan(st) {
    const id = st.id, plan = st.plan && Array.isArray(st.plan.steps) ? st.plan : { summary: "", steps: [] };
    const cur = plan.steps.findIndex((s) => !s.done);
    const setPlan = (np) => safe(op({ op: "tutor", id, patch: { plan: np } })).then(render);
    const latestPlan = () => { const s = S.students.get(id); return s.plan && s.plan.steps ? s.plan : { summary: "", steps: [] }; };
    const notes = h("textarea", { id: "pn_notes", rows: "8", value: st.notes || "", placeholder: "Anything you want to remember: learning style, parent notes, what's working…" });
    const saved = h("span", { class: "xs muted", "aria-live": "polite" });
    notes.addEventListener("change", async () => { saved.textContent = "Saving…"; try { await op({ op: "tutor", id, patch: { notes: notes.value } }); saved.textContent = "Saved"; } catch (e) { saved.textContent = e.message; } });
    return h("div", { class: "cols" },
      h("div", { class: "card private" }, h("div", { class: "card-h" }, h("h3", { text: "Course plan" }), h("button", { type: "button", class: "btn sm", text: "Paste a plan", onclick: () => openPastePlan(st) })),
        h("div", { class: "card-b" },
          plan.summary ? h("p", {}, h("strong", { text: "Strategy: " }), plan.summary) : null,
          plan.steps.length ? h("div", { style: "display:grid;gap:8px" }, plan.steps.map((s, i) => {
            const upd = (patch) => { const L = latestPlan(); return { ...L, steps: L.steps.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }; };
            return h("div", { class: "row", style: `align-items:flex-start;padding:10px 12px;border-radius:10px;border:1px solid ${i === cur ? "var(--accent)" : "var(--line-2)"};background:${i === cur ? "var(--accent-soft)" : "var(--surface-2)"};${s.done ? "opacity:.6" : ""}` },
              h("input", { type: "checkbox", checked: s.done, "aria-label": `Step ${i + 1} done`, style: "margin-top:3px;width:16px;height:16px;accent-color:var(--brand)", onchange: (e) => setPlan(upd({ done: e.target.checked })) }),
              h("div", { class: "grow", style: "display:grid;gap:2px" }, h("strong", { text: s.title }), s.focus ? h("span", { class: "small muted", text: s.focus }) : null),
              i === cur ? h("span", { class: "badge accent", text: "Current" }) : null,
              h("button", { type: "button", class: "btn ghost icon sm", "aria-label": `Remove step ${i + 1}`, text: "✕", onclick: () => { const L = latestPlan(); setPlan({ ...L, steps: L.steps.filter((x) => x.id !== s.id) }); } }));
          })) : h("p", { class: "muted", text: "No plan yet. Paste one (I can write it with you in Claude), or add steps one at a time." }),
          h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); const t = e.target.querySelector("input"); if (!t.value.trim()) return; const L = latestPlan(); setPlan({ ...L, steps: [...L.steps, { title: t.value.trim(), focus: "", done: false }] }); } },
            h("input", { type: "text", id: "pl_new", placeholder: "Add a step, e.g. Week 3: Boundaries", "aria-label": "New plan step", class: "grow", style: "flex:1" }), h("button", { type: "submit", class: "btn", text: "Add" })))),
      h("div", { class: "card private" }, h("div", { class: "card-h" }, h("h3", { text: "Private notes" }), saved), h("div", { class: "card-b" }, notes, h("p", { class: "xs muted", text: "Saves when you click outside the box." }))));
  }
  function openPastePlan(st) {
    const ta = h("textarea", { id: "pp_text", rows: "12", class: "code", placeholder: "Strategy: Math first, then grammar\nWeek 1: Linear equations | slope, systems, Desmos checks\nWeek 2: Bluebook test 2 | full test, review misses" });
    modal(`Paste a plan for ${st.name}`, h("div", { style: "display:grid;gap:10px" }, h("p", { class: "small muted", text: "One step per line. Put details after a | or a dash. A first line starting with “Strategy:” becomes the summary. This replaces the current steps." }), ta), async () => {
      let summary = ""; const steps = [];
      for (const raw of ta.value.split("\n")) {
        const line = raw.trim().replace(/^[-*•]\s*/, ""); if (!line) continue;
        const m = line.match(/^(strategy|summary)\s*:\s*(.+)$/i); if (m) { summary = m[2]; continue; }
        const parts = line.split(/\s+\|\s+|\s+[—–]\s+/); steps.push({ title: parts.shift(), focus: parts.join(" — "), done: false });
      }
      if (!steps.length) throw new Error("No steps found. Put one step on each line.");
      await op({ op: "tutor", id: st.id, patch: { plan: { summary: summary || st.plan?.summary || "", steps } } }); render(); toast(`Plan saved: ${steps.length} steps`);
    }, "Save plan");
  }
  function openProfileModal(st) {
    const p = st.profile || {};
    const i = { name: h("input", { type: "text", id: "m_name", value: st.name }), grade: h("input", { type: "text", id: "m_grade", value: p.grade || "" }), school: h("input", { type: "text", id: "m_school", value: p.school || "" }),
      contact: h("input", { type: "text", id: "m_contact", value: p.contact || "" }), test: h("input", { type: "date", id: "m_test", value: p.testDate || "" }),
      target: h("input", { type: "number", id: "m_target", min: "400", max: "1600", step: "10", value: p.target ?? "" }),
      cal: h("input", { type: "text", id: "m_cal", value: (st.calNames || []).join(", ") }),
      about: h("textarea", { id: "m_about", rows: "5", value: p.about || "", placeholder: "From their Varsity Tutors profile: background, accommodations, learning style, parent notes" }) };
    let armed = false;
    const del = h("button", { type: "button", class: "btn danger sm", text: "Delete student", onclick: async (e) => {
      if (!armed) { armed = true; e.target.textContent = "Click again to delete everything"; return; }
      try { await op({ op: "deleteStudent", id: st.id }); } catch (x) { toast(x.message); return; }
      S.students.delete(st.id); $("#modalRoot").replaceChildren(); location.hash = "home"; render(); toast("Deleted");
    } });
    modal("Edit profile", h("div", { style: "display:grid;gap:12px" },
      h("div", { class: "grid2" }, field("Name", i.name), field("Grade", i.grade), field("School", i.school), field("Contact", i.contact), field("Test date", i.test), field("Target", i.target)),
      field("Calendar names", i.cal, "as written after “SAT - ”, comma-separated"), field("About", i.about), h("div", {}, del)), async () => {
      if (!i.name.value.trim()) throw new Error("Add a name.");
      if (i.target.value && !(Number(i.target.value) >= 400 && Number(i.target.value) <= 1600)) throw new Error("Target should be between 400 and 1600.");
      await op({ op: "profile", id: st.id, name: i.name.value, calNames: i.cal.value.split(",").map((s) => s.trim()).filter(Boolean),
        profile: { grade: i.grade.value, school: i.school.value, contact: i.contact.value, testDate: i.test.value, target: i.target.value, about: i.about.value } });
      render(); toast("Saved");
    });
  }
  function openAddSession(st) {
    const date = h("input", { type: "date", id: "as_date", value: today() }), time = h("input", { type: "time", id: "as_time", value: "16:00" });
    const mins = h("input", { type: "number", id: "as_mins", value: "60", min: "15", step: "15" });
    const kind = h("select", { id: "as_kind" }, Object.entries(KIND).map(([k, l]) => h("option", { value: k, text: l })));
    modal("Add a session", h("div", { style: "display:grid;gap:12px" }, h("p", { class: "small muted", text: "Use this for sessions that aren't on your calendar. Calendar sessions appear on their own." }),
      h("div", { class: "grid3" }, field("Date", date), field("Start", time), field("Minutes", mins)), field("Type", kind)), async () => {
      if (!date.value) throw new Error("Pick a date.");
      const off = -new Date(`${date.value}T${time.value || "16:00"}:00`).getTimezoneOffset(); const sign = off >= 0 ? "+" : "-"; const a = Math.abs(off);
      const r = await op({ op: "addSession", id: st.id, date: date.value, time: time.value, mins: mins.value, offset: `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`, patch: { kind: kind.value } });
      location.hash = `session/${st.id}/${encodeURIComponent(r.sessionId)}`;
    }, "Add session");
  }

  /* ---------- one session ---------- */
  function renderSession(studentId, sessionId) {
    const st = S.students.get(studentId), s = st && st.sessions.find((x) => x.id === sessionId);
    if (!s) { view().replaceChildren(h("div", { class: "card" }, h("div", { class: "card-b" }, h("h2", { text: "Session not found" }), h("a", { href: "#home", text: "Back to overview" })))); return; }
    const past = (s.end || s.start) < Date.now();
    const status = h("span", { class: "xs muted", "aria-live": "polite" });
    const save = async (patch, quiet) => {
      status.textContent = "Saving…";
      try { await op({ op: "session", id: studentId, sessionId, patch }); status.textContent = "All changes saved"; if (!quiet) renderSessionKeep(); }
      catch (e) { status.textContent = ""; toast(e.message); }
    };
    const area = (key, rows, ph, cls) => { const t = h("textarea", { id: "se_" + key, rows: String(rows), value: s[key] || "", placeholder: ph, class: cls || null }); t.addEventListener("change", () => save({ [key]: t.value }, true)); return t; };
    const preview = (t) => { const box = h("div", { hidden: true }); const btn = h("button", { type: "button", class: "btn ghost sm", text: "Preview", onclick: () => { const on = box.hidden; box.hidden = !on; t.hidden = on; btn.textContent = on ? "Edit" : "Preview"; if (on) box.replaceChildren(t.value.trim() ? markdown(t.value) : h("p", { class: "muted", text: "Nothing yet." })); } }); return { box, btn }; };
    const agenda = area("agenda", 7, "What you'll cover, in order. Students see this.\n- Warm-up: 5 boundary questions\n- Teach: semicolons vs. commas\n- Practice: 10 mixed questions");
    const notes = area("notes", 12, "Paste your Granola notes here after the session. Students see these.", "code");
    const hw = area("homework", 3, "e.g. 15 Boundaries questions in the question bank, Medium and Hard");
    const priv = area("privateNote", 3, "Only you see this.");
    const pa = preview(agenda), pn = preview(notes);
    const kind = h("select", { id: "se_kind" }, Object.entries(KIND).map(([k, l]) => h("option", { value: k, text: l }))); kind.value = s.kind || "skill";
    const cat = categorySelect("se_cat", s.category || "");
    const skill = skillSelect("se_skill", s.category || "", s.skill || "");
    const score = h("input", { type: "number", id: "se_score", min: "400", max: "1600", step: "10", value: s.practiceScore ?? "", placeholder: "optional" });
    const saveFocus = () => save({ kind: kind.value, category: cat.value, skill: skill.value });
    kind.addEventListener("change", saveFocus); cat.addEventListener("change", () => { skill.refill(cat.value, ""); saveFocus(); }); skill.addEventListener("change", saveFocus);
    score.addEventListener("change", () => save({ practiceScore: score.value }, true));
    const sug = suggestSkill(st);
    const qs = st.allQuestions.filter((q) => q.sessionId === s.id);
    view().replaceChildren(
      h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: `#student/${st.id}`, text: st.name }), h("span", { text: "/" }), h("a", { href: `#student/${st.id}/sessions`, text: "Sessions" }), h("span", { text: "/" }), h("span", { text: fmtShort(s.start) })),
      h("div", { class: "page-head" }, h("div", { class: "grow" },
        h("div", { class: "row", style: "gap:8px" }, h("span", { class: "badge brand", text: KIND[s.kind] || "Session" }), s.calendar ? h("span", { class: "badge", text: "From calendar" }) : h("span", { class: "badge", text: "Added by you" }), s.cancelled ? h("span", { class: "badge bad", text: "Cancelled" }) : null),
        h("h1", { text: sessionTitle(s) }), h("p", { class: "muted", text: `${st.name} · ${fmtDay(s.start)} · ${fmtTime(s.start)}${s.end ? " – " + fmtTime(s.end) : ""}` })),
        status, past ? null : prepToggle(st, s, renderSessionKeep)),
      h("div", { class: "cols" },
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Session plan" }), pa.btn), h("div", { class: "card-b" }, agenda, pa.box, h("p", { class: "xs muted", text: "Shown to the student. Saves when you click outside the box." }))),
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Session notes" }), h("span", { class: "xs muted", text: "Granola" }), pn.btn), h("div", { class: "card-b" }, notes, pn.box, h("p", { class: "xs muted", text: "Paste from Granola. Headings and bullet points keep their formatting. Shown to the student." }))),
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Homework" }), s.homework ? h("span", { class: "badge " + (st.hw && st.hw[s.id] ? "good" : "accent"), text: st.hw && st.hw[s.id] ? "Student marked done" : "Not done yet" }) : null), h("div", { class: "card-b" }, hw)),
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Questions from this session" }), h("span", { class: "xs muted", text: `${qs.length}` })),
            h("div", { class: "card-b tight" }, questionTable(qs, { empty: "No questions logged for this session yet.", sessions: st.sessions, showBy: true, canDelete: () => true, onDelete: (q) => safe(op({ op: "deleteQuestion", id: st.id, qid: q.id })).then(renderSessionKeep) })),
            h("details", {}, h("summary", { class: "card-h", style: "border-top:1px solid var(--line-2)" }, h("span", { class: "linkbtn", text: "+ Log a question from this session" })),
              h("div", { class: "card-b" }, questionForm("sq", async (q) => { await op({ op: "addQuestion", id: st.id, question: q }); renderSessionKeep(); }, { sessionId: s.id }))))),
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Focus" })), h("div", { class: "card-b" },
            field("Type", kind), field("Category", cat), field("Skill", skill),
            sug && !s.skill ? h("button", { type: "button", class: "callout", style: "text-align:left;cursor:pointer;font:inherit;color:inherit", onclick: () => { cat.value = sug.cat; skill.refill(sug.cat, sug.skill); saveFocus(); } },
              h("strong", { text: "Use weakest skill: " }), `${sug.skill} (${sug.right}/${sug.n} right)`) : null,
            field("Practice test score", score, "if they took one"))),
          h("div", { class: "card private" }, h("div", { class: "card-h" }, h("h3", { text: "Private note" })), h("div", { class: "card-b" }, priv)),
          h("div", { class: "card" }, h("div", { class: "card-b row" },
            h("button", { type: "button", class: "btn sm", text: s.cancelled ? "Mark as happening" : "Mark cancelled", onclick: () => save({ cancelled: !s.cancelled }) }),
            !s.calendar ? h("button", { type: "button", class: "btn sm danger", text: "Delete session", onclick: async () => { await safe(op({ op: "deleteSession", id: st.id, sessionId: s.id })); location.hash = `student/${st.id}/sessions`; } }) : null)))));
  }
  function renderSessionKeep() { const y = window.scrollY; render(); window.scrollTo(0, y); }

  /* ---------- routing ---------- */
  function render() {
    const parts = (location.hash.slice(1) || "home").split("/");
    renderRoster();
    if (!S.loaded) return;
    if (parts[0] === "student") renderStudent(parts[1], parts[2]);
    else if (parts[0] === "session") renderSession(parts[1], decodeURIComponent(parts.slice(2).join("/")));
    else renderHome();
  }
  window.addEventListener("hashchange", async () => {
    render(); window.scrollTo(0, 0);
    if (Date.now() - (S.at || 0) > 20000) { try { await load(false); if (!$("#modalRoot").childElementCount && !document.activeElement?.matches("input,textarea,select")) render(); } catch {} }
  });
  $("#navHome").onclick = () => (location.hash = "home");
  $("#q").addEventListener("input", renderRoster);
  $("#logout").onclick = logout;
  $("#addBtn").onclick = () => {
    const name = h("input", { type: "text", id: "n_name", placeholder: "e.g. Jordan P." });
    const cal = h("input", { type: "text", id: "n_cal", placeholder: "Same as name" });
    modal("Add student", h("div", { class: "grid2", style: "grid-template-columns:1fr" }, field("Name", name), field("Calendar name", cal, "as written after “SAT - ”")), async () => {
      if (!name.value.trim()) throw new Error("Add a name.");
      const r = await op({ op: "addStudent", name: name.value, calNames: [cal.value.trim() || name.value.trim()] }); location.hash = `student/${r.student.id}`; toast("Added");
    }, "Add student");
  };
  (async () => {
    try { const me = await api("/api/login"); if (me.role !== "tutor") { location.href = "/"; return; } $("#who").textContent = me.name; $("#av").textContent = initials(me.name); } catch { return; }
    try { await load(false); } catch (e) { view().replaceChildren(h("div", { class: "loading", text: e.message })); return; }
    render();
    setInterval(async () => {
      if (document.hidden || $("#modalRoot").childElementCount || document.activeElement?.matches("input,textarea,select")) return;
      try { await load(false); const y = window.scrollY; render(); window.scrollTo(0, y); } catch {}
    }, 3 * 60 * 1000);
  })();
})();
