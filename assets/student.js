(() => {
  "use strict";
  const { $, h, toast, api, DOMAINS, daysUntil, questionForm, accuracy, questionTable, logout } = SAT;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let me = null;

  /* tabs */
  function show(tab) {
    const q = tab === "q";
    $("#tabQ").setAttribute("aria-selected", String(q)); $("#tabG").setAttribute("aria-selected", String(!q));
    $("#pQ").hidden = !q; $("#pG").hidden = q;
    history.replaceState(null, "", q ? "#questions" : "#goals");
  }
  $("#tabQ").onclick = () => show("q"); $("#tabG").onclick = () => show("g");
  $("#logout").onclick = logout;

  /* questions */
  $("#qForm").append(questionForm("sq", async (q) => { me = await api("/api/student", { body: { op: "addQuestion", question: q } }); renderQuestions(); }));
  $("#qFilter").addEventListener("change", renderQuestions);
  function renderQuestions() {
    const all = me.questions || [], f = $("#qFilter").value;
    const list = all.filter((q) => f === "all" || (f === "miss" ? q.result !== "right" : q.section === f));
    $("#qCount").textContent = `${all.length} logged`;
    $("#acc").replaceChildren(accuracy(all));
    $("#qList").replaceChildren(questionTable(list.slice(0, 300), {
      canDelete: (q) => q.by === "student",
      onDelete: async (q) => { try { me = await api("/api/student", { body: { op: "deleteQuestion", id: q.id } }); renderQuestions(); toast("Deleted"); } catch (e) { toast(e.message); } },
      showBy: true,
    }));
  }

  /* goals form */
  function buildGoals() {
    const wrap = $("#bubbles");
    for (const [group, , items] of DOMAINS) {
      wrap.append(h("div", { class: "bubbles" }, h("h3", { text: group }),
        items.map(([k, l]) => h("label", { class: "bub" }, h("input", { type: "checkbox", name: "focus", value: k, id: "f_" + k }), h("span", { class: "o", "aria-hidden": "true" }), l))));
    }
    DAYS.forEach((d) => $("#daychips").append(h("label", { class: "day" }, h("input", { type: "checkbox", name: "day", value: d, id: "d_" + d }), h("span", { text: d }))));
    $("#goalForm").addEventListener("input", scoreline);
    $("#goalForm").addEventListener("submit", saveGoals);
  }
  function fillGoals(p) {
    const set = (id, v) => { if (v != null) $(id).value = v; };
    set("#s_grade", p.grade); set("#s_school", p.school); set("#s_test", p.testDate); set("#s_contact", p.contact);
    set("#s_rw", p.scores?.rw); set("#s_math", p.scores?.math); set("#s_src", p.scores?.source); set("#s_target", p.target);
    (p.goals || []).forEach((g, i) => set("#g" + (i + 1), g)); set("#s_hard", p.hardest); set("#s_else", p.extra); set("#s_time", p.times);
    document.querySelectorAll("input[name=focus]").forEach((i) => (i.checked = (p.focus || []).includes(i.value)));
    document.querySelectorAll("input[name=day]").forEach((i) => (i.checked = (p.days || []).includes(i.value)));
    if (p.updatedAt) $("#savedAt").textContent = "Last saved " + new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    scoreline();
  }
  const clamp = (v, lo, hi) => { if (v === "") return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  function scoreline() {
    const rw = clamp($("#s_rw").value, 200, 800), m = clamp($("#s_math").value, 200, 800), t = clamp($("#s_target").value, 400, 1600);
    const el = $("#scoreline"); el.replaceChildren();
    const cur = rw && m ? rw + m : null;
    el.append("Current total ", h("b", { text: cur ?? "—" }), " · Target ", h("b", { text: t ?? "—" }));
    if (cur && t) el.append(" · ", h("b", { text: t > cur ? `+${t - cur}` : "0" }), t > cur ? " points to go" : " already there");
    const dd = daysUntil($("#s_test").value);
    if (dd != null && dd >= 0) el.append(" · ", h("b", { text: dd }), dd === 1 ? " day until test" : " days until test");
  }
  async function saveGoals(e) {
    e.preventDefault();
    const err = $("#formErr"); err.textContent = "";
    for (const [id, lo, hi, lab] of [["#s_rw", 200, 800, "Reading & Writing"], ["#s_math", 200, 800, "Math"], ["#s_target", 400, 1600, "Target"]]) {
      const v = $(id).value; if (v && clamp(v, lo, hi) == null) { err.textContent = `${lab} should be between ${lo} and ${hi}.`; $(id).focus(); return; }
    }
    const profile = {
      grade: $("#s_grade").value, school: $("#s_school").value, testDate: $("#s_test").value, contact: $("#s_contact").value,
      scores: { rw: $("#s_rw").value, math: $("#s_math").value, source: $("#s_src").value }, target: $("#s_target").value,
      focus: [...document.querySelectorAll("input[name=focus]:checked")].map((i) => i.value),
      goals: [$("#g1").value, $("#g2").value, $("#g3").value], hardest: $("#s_hard").value, extra: $("#s_else").value,
      days: [...document.querySelectorAll("input[name=day]:checked")].map((i) => i.value), times: $("#s_time").value,
    };
    const btn = $("#saveGoals"); btn.disabled = true;
    try { me = await api("/api/student", { body: { op: "profile", profile } }); fillGoals(me.profile); toast("Goals saved. Your tutor can see them now."); }
    catch (e2) { err.textContent = e2.message; }
    finally { btn.disabled = false; }
  }

  async function boot() {
    buildGoals();
    try { me = await api("/api/student"); } catch (e) { toast(e.message); return; }
    $("#hello").textContent = `Hi, ${me.name.split(" ")[0]}!`; $("#who").textContent = me.name;
    fillGoals(me.profile || {});
    renderQuestions();
    const noGoals = !(me.profile && (me.profile.goals || []).length);
    show(location.hash === "#goals" || (noGoals && location.hash !== "#questions") ? "g" : "q");
  }
  boot();
})();
