// Everything a logged-in student can do. Their id comes only from the signed cookie.
import { handler, readBody, ok, fail, requireStudent, loadStudent, updateJSON, P, cleanProfile, cleanQuestion, cleanScore,
  calendarEvents, mergeSessions, studentSafeSession, str, upgradeStudent } from "./_lib/core.js";

async function view(id) {
  const p = await loadStudent(id, true); if (!p) return null;
  const cal = await calendarEvents(false);
  const s = p.student, t = p.tutor;
  const sessions = mergeSessions(p, cal.events).filter((x) => !x.cancelled).map((x) => studentSafeSession(x, s.hw));
  const plan = t.plan && t.plan.steps && t.plan.steps.length ? t.plan : null;
  return { id, name: s.name, profile: s.profile, scores: s.scores, sessions, plan,
    questions: [...s.questions, ...(t.questions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at)) };
}

export default handler(async (req, res) => {
  const sess = requireStudent(req, res); if (!sess) return;
  const id = sess.id;
  if (req.method === "GET") { const v = await view(id); return v ? ok(res, v) : fail(res, 401, "We couldn't find your profile. Log in again."); }
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const b = await readBody(req);
  const change = (fn) => updateJSON(P.student(id), null, (s) => (s ? fn(upgradeStudent(s)) : undefined));
  switch (b.op) {
    case "profile": await change((s) => { s.profile = cleanProfile(b.profile || {}, s.profile); return s; }); break;
    case "addScore": { const sc = cleanScore(b.score); await change((s) => { s.scores = [...s.scores, { ...sc, by: "student" }].slice(-100); return s; }); break; }
    case "deleteScore": await change((s) => { s.scores = s.scores.filter((x) => x.id !== str(b.scoreId, 40)); return s; }); break;
    case "addQuestion": { const q = cleanQuestion(b.question, "student"); await change((s) => { s.questions = [...s.questions, q].slice(-3000); return s; }); break; }
    case "deleteQuestion": await change((s) => { s.questions = s.questions.filter((q) => q.id !== str(b.qid, 40)); return s; }); break;
    case "homework": await change((s) => { s.hw = { ...s.hw, [str(b.sessionId, 200)]: !!b.done }; return s; }); break;
    default: return fail(res, 400, "Unknown action");
  }
  return ok(res, await view(id));
});
