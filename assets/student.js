(() => {
  "use strict";
  const { $, h, toast, api, logout, CATEGORIES, KIND, fmtDate, fmtDay, fmtShort, fmtTime, daysUntil, relDay, initials,
    sessionTitle, sessionSub, datebox, splitSessions, markdown, field, modal, questionForm, filterQuestions, questionFilters, questionTable,
    skillBars, scoreChart, scoreList, openScoreModal, goalsCard, scoreTotal, homeworkCard, dueBadge } = SAT;
  let me = null;
  const qf = { result: "miss" };
  const view = () => $("#view");

  async function act(body) { me = await api("/api/student", { body }); return me; }

  /* ---------- shared bits ---------- */
  function sessionItem(s, opts = {}) {
    const rel = relDay(s.start);
    const right = [];
    if (s.homework) right.push(s.hwDone ? h("span", { class: "badge good", text: "Homework done" }) : dueBadge(s.homeworkDue, false));
    if (opts.showKind !== false && s.kind) right.push(h("span", { class: "badge", text: KIND[s.kind] || "Session" }));
    return h("a", { class: "item", href: "#session/" + encodeURIComponent(s.id) },
      datebox(s.start),
      h("span", { class: "title", text: sessionTitle(s) }),
      h("span", { class: "row", style: "gap:6px;justify-content:flex-end;grid-row:span 2" }, right),
      h("span", { class: "sub", text: (rel ? rel + " · " : "") + sessionSub(s) }));
  }
  function emptyCard(text) { return h("div", { class: "empty", text }); }

  /* ---------- dashboard ---------- */
  function renderHome() {
    const { upcoming, past } = splitSessions(me.sessions);
    const next = upcoming[0];
    const p = me.profile || {};
    const d = daysUntil(p.testDate);
    const latest = [...me.scores].filter(scoreTotal).sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1))[0];
    const misses = me.questions.filter((q) => q.result !== "right").length;

    const hero = next ? h("section", { class: "hero", "aria-label": "Next session" },
      h("div", { class: "row" }, h("span", { class: "eyebrow", text: "Your next session" }), h("span", { class: "when", text: relDay(next.start) || fmtShort(next.start) })),
      h("h2", { text: sessionTitle(next) }),
      h("div", { class: "meta" }, h("span", { text: fmtDay(next.start) }), h("span", { text: fmtTime(next.start) + (next.end ? " – " + fmtTime(next.end) : "") }),
        next.category ? h("span", { text: CATEGORIES[next.category]?.name }) : null, next.kind ? h("span", { text: KIND[next.kind] }) : null),
      next.topic && next.topic !== sessionTitle(next) ? h("div", { style: "background:rgb(255 255 255 / .1);border-radius:10px;padding:10px 14px;font-size:14.5px" }, h("span", { class: "eyebrow", style: "margin-right:8px", text: "Topic" }), next.topic) : null,
      h("div", { class: "row" }, h("a", { class: "btn", href: "#session/" + encodeURIComponent(next.id), text: "Open session" })))
      : h("section", { class: "card" }, h("div", { class: "card-b" }, h("span", { class: "eyebrow", text: "Your next session" }), h("h2", { text: "Nothing scheduled yet" }), h("p", { class: "muted", text: "Your next session will show up here as soon as it's booked." })));

    const upcomingCard = upcoming.length > 1 ? h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Coming up" })), h("div", { class: "list" }, upcoming.slice(1, 5).map((s) => sessionItem(s)))) : null;
    const pastCard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Previous sessions" }), past.length > 6 ? h("a", { href: "#sessions", class: "small", text: "See all" }) : null),
      h("div", { class: "list" }, past.length ? past.slice(0, 6).map((s) => sessionItem(s)) : [emptyCard("Your past sessions and their notes will appear here.")]));

    const testCard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Test day" }), h("button", { type: "button", class: "btn ghost sm", text: "Edit", onclick: openTestModal })),
      h("div", { class: "card-b" },
        h("div", { class: "grid2", style: "grid-template-columns:1fr 1fr" },
          h("div", {}, h("div", { class: "eyebrow", text: "Test date" }), h("div", { style: "font-weight:700;font-size:16px", text: p.testDate ? fmtDate(p.testDate) : "Not set" }), d != null && d >= 0 ? h("div", { class: "small muted", text: `${d} day${d === 1 ? "" : "s"} to go` }) : null),
          h("div", {}, h("div", { class: "eyebrow", text: "Target" }), h("div", { class: "mono", style: "font-weight:700;font-size:20px", text: p.target ?? "—" }), latest ? h("div", { class: "small muted", text: `Latest ${scoreTotal(latest)}` }) : null))));

    const chart = scoreChart(me.scores, p.target);
    const scoresCard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Scores" }), h("button", { type: "button", class: "btn sm", text: "Add score", onclick: () => openScoreModal(async (score) => { await act({ op: "addScore", score }); render(); toast("Score added"); }) })),
      h("div", { class: "card-b" }, chart, scoreList(me.scores, { canDelete: (s) => s.by === "student", onDelete: async (s) => { await act({ op: "deleteScore", scoreId: s.id }); render(); } })));

    const goals = goalsCard((p.goals || []).map((g) => ({ ...g })), async (goals) => { try { await act({ op: "profile", profile: { goals } }); } catch (e) { toast(e.message); } },
      { title: "Your goals", badge: "Optional", empty: "Want to set a goal? Add one below. Your tutor can see these." });

    const qCard = h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Question practice" }), h("a", { href: "#questions", class: "btn sm", text: "Log a question" })),
      h("div", { class: "card-b" }, h("p", { class: "small muted", text: `${me.questions.length} logged · ${misses} to review` }), skillBars(me.questions, 4)));

    const hwCard = homeworkCard(me.sessions, { isDone: (x) => x.hwDone, href: (x) => "#session/" + encodeURIComponent(x.id), emptyText: "No homework right now. Nice!",
      onToggle: async (x, done) => { try { await act({ op: "homework", sessionId: x.id, done }); render(); toast(done ? "Nice work!" : "Marked not done"); } catch (e) { toast(e.message); } } });
    view().replaceChildren(
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("span", { class: "eyebrow", text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) }), h("h1", { text: `Welcome back, ${me.name.split(" ")[0]}` }))),
      h("div", { class: "cols" }, h("div", { class: "stack" }, hero, hwCard, upcomingCard, pastCard, qCard), h("div", { class: "stack" }, testCard, scoresCard, goals)));
  }
  function openTestModal() {
    const p = me.profile || {};
    const date = h("input", { type: "date", id: "t_date", value: p.testDate || "" });
    const target = h("input", { type: "number", id: "t_target", min: "400", max: "1600", step: "10", value: p.target ?? "" });
    modal("Test date and target", h("div", { class: "grid2" }, field("Test date", date), field("Target score", target, "400–1600")), async () => {
      if (target.value && !(Number(target.value) >= 400 && Number(target.value) <= 1600)) throw new Error("Target should be between 400 and 1600.");
      await act({ op: "profile", profile: { testDate: date.value, target: target.value } }); render(); toast("Saved");
    });
  }

  /* ---------- sessions list ---------- */
  function renderSessions() {
    const { upcoming, past } = splitSessions(me.sessions);
    view().replaceChildren(
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", { text: "Sessions" }), h("p", { class: "muted", text: "Open any session to see its plan, notes and homework." }))),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Upcoming" })), h("div", { class: "list" }, upcoming.length ? upcoming.map((s) => sessionItem(s)) : [emptyCard("No upcoming sessions yet.")])),
      h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Previous" })), h("div", { class: "list" }, past.length ? past.map((s) => sessionItem(s)) : [emptyCard("No past sessions yet.")])));
  }

  /* ---------- one session ---------- */
  function renderSession(id) {
    const s = me.sessions.find((x) => x.id === id);
    if (!s) { view().replaceChildren(h("div", { class: "card" }, h("div", { class: "card-b" }, h("h2", { text: "Session not found" }), h("a", { href: "#sessions", text: "Back to sessions" })))); return; }
    const past = (s.end || s.start) < Date.now();
    const qs = me.questions.filter((q) => q.sessionId === s.id);
    const c = s.category ? CATEGORIES[s.category] : null;
    const hw = s.homework ? h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Homework" }),
      h("label", { class: "prep" + (s.hwDone ? " on" : ""), style: "position:relative" }, h("input", { type: "checkbox", checked: s.hwDone, onchange: async (e) => { try { await act({ op: "homework", sessionId: s.id, done: e.target.checked }); render(); toast(e.target.checked ? "Nice work!" : "Marked not done"); } catch (x) { toast(x.message); } } }), h("span", { class: "o" }), s.hwDone ? "Done" : "Mark done")),
      h("div", { class: "card-b" }, markdown(s.homework), h("div", {}, dueBadge(s.homeworkDue, s.hwDone)))) : null;
    view().replaceChildren(
      h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#sessions", text: "Sessions" }), h("span", { text: "/" }), h("span", { text: fmtShort(s.start) })),
      h("div", { class: "page-head" }, h("div", { class: "grow" },
        h("div", { class: "row", style: "gap:8px" }, h("span", { class: "badge brand", text: KIND[s.kind] || "Session" }), past ? h("span", { class: "badge", text: "Completed" }) : h("span", { class: "badge good dot", text: relDay(s.start) || "Upcoming" })),
        h("h1", { text: sessionTitle(s) }),
        h("p", { class: "muted", text: `${fmtDay(s.start)} · ${fmtTime(s.start)}${s.end ? " – " + fmtTime(s.end) : ""}` }))),
      h("div", { class: "cols" },
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Session notes" })), h("div", { class: "card-b" }, s.notes ? markdown(s.notes) : h("p", { class: "muted", text: past ? "Notes will appear here once your tutor adds them." : "Notes from the session will appear here afterward." }))),
          hw,
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Questions from this session" }), h("button", { type: "button", class: "btn sm", text: "Log a question", onclick: () => openQuestionModal(s.id) })),
            h("div", { class: "card-b tight" }, questionTable(qs, { empty: "No questions logged for this session yet.", sessions: me.sessions, canDelete: (q) => q.by === "student", onDelete: delQ })))),
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Focus" })), h("div", { class: "card-b" },
            h("dl", { class: "kv" }, h("dt", { text: "Topic" }), h("dd", { text: s.topic || s.skill || "To be decided" }), h("dt", { text: "Type" }), h("dd", { text: KIND[s.kind] || "Session" }),
              h("dt", { text: "Category" }), h("dd", { text: c ? c.name : "—" }), h("dt", { text: "Skill" }), h("dd", { text: s.skill || "—" }),
              s.practiceScore ? h("dt", { text: "Practice score" }) : null, s.practiceScore ? h("dd", { class: "mono", text: s.practiceScore }) : null))))));
  }

  /* ---------- questions ---------- */
  async function delQ(q) { try { await act({ op: "deleteQuestion", qid: q.id }); render(); toast("Deleted"); } catch (e) { toast(e.message); } }
  function openQuestionModal(sessionId) {
    let close;
    const form = questionForm("mq", async (q) => { await act({ op: "addQuestion", question: q }); close(); render(); }, { sessions: me.sessions, sessionId });
    close = modal("Log a question", form, () => false, "", { hideOk: true });
  }
  function renderQuestions() {
    const list = filterQuestions(me.questions, qf);
    const table = h("div", {});
    const redraw = () => table.replaceChildren(questionTable(filterQuestions(me.questions, qf), { sessions: me.sessions, canDelete: (q) => q.by === "student", onDelete: delQ }));
    redraw();
    view().replaceChildren(
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", { text: "Questions" }), h("p", { class: "muted", text: "Log the practice questions you miss or guess on. The question ID is shown in Bluebook and the College Board question bank." }))),
      h("div", { class: "cols" },
        h("div", { class: "stack" },
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Log a question" })), h("div", { class: "card-b" }, questionForm("sq", async (q) => { await act({ op: "addQuestion", question: q }); renderQuestions(); }, { sessions: me.sessions }))),
          h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Your questions" }), h("span", { class: "xs muted", text: `${list.length} shown · ${me.questions.length} total` })),
            h("div", { class: "card-b", style: "padding-bottom:0" }, questionFilters(qf, () => { redraw(); })), h("div", { class: "card-b tight" }, table))),
        h("div", { class: "stack" }, h("div", { class: "card" }, h("div", { class: "card-h" }, h("h3", { text: "Weakest skills" })), h("div", { class: "card-b" }, skillBars(me.questions, 10))))));
  }

  /* ---------- routing ---------- */
  function render() {
    const hash = decodeURIComponent(location.hash.slice(1) || "home");
    const [v, arg] = hash.split("/");
    document.querySelectorAll(".appbar nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.v === (v === "session" ? "sessions" : v)) && a.setAttribute("aria-current", "page"));
    if (v === "session") renderSession(hash.slice(8));
    else if (v === "sessions") renderSessions();
    else if (v === "questions") renderQuestions();
    else renderHome();
  }
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  $("#logout").onclick = logout;
  (async () => {
    try { me = await api("/api/student"); } catch (e) { view().replaceChildren(h("div", { class: "loading", text: e.message })); return; }
    $("#who").textContent = me.name; $("#av").textContent = initials(me.name);
    render();
    setInterval(async () => { if (document.hidden || $("#modalRoot").childElementCount || document.activeElement?.matches("input,textarea,select")) return; try { me = await api("/api/student"); render(); } catch {} }, 5 * 60 * 1000);
  })();
})();
