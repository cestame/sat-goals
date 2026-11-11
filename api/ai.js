// Optional AI drafting (needs ANTHROPIC_API_KEY). Builds the prompt from stored data, never from the browser.
import { handler, readBody, ok, fail, requireTutor, loadStudent, updateJSON, P, DOMAINS, str, newId, cleanPlan } from "./_lib/core.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
async function claude(prompt, maxTokens = 1800) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(r.status === 401 ? "The Anthropic API key isn't valid. Check ANTHROPIC_API_KEY in Vercel." : r.status === 429 ? "AI usage limit reached for now. Try again later." : "The AI service had a problem. Try again."), { status: 502 });
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
}
const days = (iso) => { if (!iso) return null; const d = new Date(iso + "T00:00:00Z"); return Math.round((d - Date.now()) / 86400e3); };

function context(p) {
  const s = p.student, t = p.tutor, pr = s.profile || {}, sc = pr.scores || {};
  const cur = sc.rw && sc.math ? sc.rw + sc.math : null;
  const L = [`Student: ${s.name}${pr.grade ? `, ${pr.grade} grade` : ""}${pr.school ? `, ${pr.school}` : ""}`];
  L.push(`Starting score: ${cur ? `${cur} (R&W ${sc.rw}, Math ${sc.math}${sc.source ? `, from ${sc.source}` : ""})` : "unknown"}. Target: ${pr.target ?? "unknown"}.`);
  L.push(`Test date: ${pr.testDate ? `${pr.testDate} (${days(pr.testDate)} days away)` : "not set"}.`);
  if ((pr.goals || []).length) L.push("Student's own goals: " + pr.goals.map((g, i) => `(${i + 1}) ${g}`).join(" "));
  if ((pr.focus || []).length) L.push("Areas they asked to work on: " + pr.focus.map((k) => DOMAINS[k]).join(", "));
  if (pr.hardest) L.push("Hardest so far, in their words: " + pr.hardest);
  if (pr.extra) L.push("Other notes: " + pr.extra);
  if (t.notes) L.push("Tutor's private notes: " + t.notes.slice(0, 2500));
  const qs = [...(s.questions || []), ...(t.questions || [])];
  if (qs.length) {
    const by = {};
    for (const q of qs) { const k = q.domain || "other"; by[k] = by[k] || { n: 0, right: 0 }; by[k].n++; if (q.result === "right") by[k].right++; }
    L.push(`Question log (${qs.length} questions): ` + Object.entries(by).map(([k, v]) => `${DOMAINS[k] || "Unsorted"} ${v.right}/${v.n} right`).join("; "));
    const misses = qs.filter((q) => q.result !== "right").sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
    if (misses.length) { L.push("Recent missed or guessed questions:"); misses.forEach((q) => L.push(`  ${q.date} ${DOMAINS[q.domain] || q.section}${q.difficulty ? ` (${q.difficulty})` : ""}: ${q.topic || "no topic"}${q.note ? ` — ${q.note.slice(0, 160)}` : ""}`)); }
  } else L.push("Question log: empty.");
  const plan = t.plan || { steps: [] };
  if ((plan.steps || []).length) {
    L.push("Course plan" + (plan.summary ? ` (${plan.summary})` : "") + ":");
    plan.steps.forEach((st, i) => L.push(`  ${i + 1}. [${st.done ? "done" : "to do"}] ${st.title}${st.focus ? ` — ${st.focus}` : ""}`));
    const c = plan.steps.findIndex((x) => !x.done); if (c >= 0) L.push(`Current plan step: ${c + 1}. ${plan.steps[c].title}`);
  } else L.push("Course plan: none yet.");
  const ss = [...(t.sessions || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  if (ss.length) { L.push("Recent sessions, newest first:"); ss.forEach((x) => L.push(`  ${x.date}: ${x.mins} min. Covered: ${x.topics || "(not noted)"}. Homework: ${x.homework || "none"}${x.homework ? ` (${x.hwDone ? "done" : "not done"})` : ""}.${x.score ? ` Practice score ${x.score}.` : ""}`)); }
  else L.push("No sessions logged yet.");
  return L.join("\n");
}

export default handler(async (req, res) => {
  if (!requireTutor(req, res)) return;
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 501, "AI drafting isn't set up. Add ANTHROPIC_API_KEY in Vercel to turn it on.");
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const b = await readBody(req);
  const p = await loadStudent(str(b.id, 40), true); if (!p) return fail(res, 404, "Student not found");

  if (b.kind === "prep") {
    const eventId = str(b.eventId, 200), start = new Date(Number(b.start)), mins = Math.max(15, Math.min(240, Number(b.mins) || 60));
    if (!eventId || isNaN(start)) return fail(res, 400, "Missing session details");
    const when = start.toLocaleString("en-US", { timeZone: process.env.TUTOR_TZ || "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const text = await claude(`You are helping an SAT tutor get ready for one upcoming session on the digital SAT (Reading & Writing and Math, adaptive modules, Desmos allowed on Math). Write a prep brief the tutor can read in two minutes.

Session: ${when}, ${mins} minutes.

${context(p)}

Write plain text with no markdown symbols (no **, no #). Use exactly these four section labels, each alone on its line:
FOCUS
BEFORE THE SESSION
SESSION OUTLINE
HOMEWORK TO ASSIGN
Under each, write 2 to 4 short lines that start with "- ". In SESSION OUTLINE put a minute count at the start of each line, adding up to ${mins}. Tie the choices to the current plan step, the student's own goals and the patterns in their question log, and follow up on unfinished homework. Name specific SAT question types and skills. If key information is missing, say in FOCUS what to find out during this session rather than inventing details.`);
    const prep = await updateJSON(P.prep, {}, (all) => { all[eventId] = { ...(all[eventId] || {}), aiPrep: text, aiPrepAt: Date.now(), student: p.id }; return all; });
    return ok(res, { text, prep });
  }
  if (b.kind === "plan") {
    const d = days(p.student.profile?.testDate);
    const weeks = d != null && d > 0 ? Math.max(3, Math.min(12, Math.ceil(d / 7))) : 8;
    const text = await claude(`You are an experienced SAT tutor building a course plan for one student on the digital SAT (Reading & Writing domains: Information & Ideas, Craft & Structure, Expression of Ideas, Standard English Conventions; Math domains: Algebra, Advanced Math, Problem-Solving & Data Analysis, Geometry & Trigonometry). Make a ${weeks}-week plan, one step per week, ordered so the biggest score gains and the student's own goals come first, using the question log to find weak spots, with a full Bluebook practice test every 2 to 3 weeks and the last week as review and test-day strategy.

${context(p)}

Reply with only JSON in this shape, nothing else:
{"summary": "one sentence on the overall strategy", "steps": [{"title": "Week 1: short title", "focus": "what to cover and practice, one or two sentences"}]}`, 2500);
    let j; try { j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return fail(res, 502, "The plan came back in the wrong shape. Try again."); }
    const plan = cleanPlan({ summary: j.summary, steps: (j.steps || []).map((s) => ({ id: newId(), title: s.title, focus: s.focus, done: false })), draftedAt: Date.now() });
    if (!plan.steps.length) return fail(res, 502, "The plan came back empty. Try again.");
    await updateJSON(P.tutor(p.id), null, (t) => { t.plan = plan; return t; });
    return ok(res, { plan });
  }
  return fail(res, 400, "Unknown request");
});
