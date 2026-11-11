// Tutor-only: every student, every session. Requires the tutor's signed cookie.
import { handler, readBody, ok, fail, requireTutor, ensureSeed, loadAll, loadStudent, readJSON, writeJSON, updateJSON, removePrefix,
  P, blankStudent, blankTutor, newId, str, norm, cleanProfile, cleanQuestion, cleanScore, cleanSessionPatch, cleanPlan,
  calendarEvents, mergeSessions, upgradeStudent, upgradeTutor } from "./_lib/core.js";

const STATUSES = ["New", "Active", "Paused", "Done"];
const view = (p, events) => ({
  id: p.id, name: p.student.name, createdAt: p.student.createdAt, profile: p.student.profile, scores: p.student.scores,
  studentQuestions: p.student.questions, hw: p.student.hw,
  status: p.tutor.status, calNames: p.tutor.calNames, notes: p.tutor.notes, plan: p.tutor.plan, questions: p.tutor.questions,
  sessions: mergeSessions(p, events),
});

export default handler(async (req, res) => {
  if (!requireTutor(req, res)) return;
  if (req.method === "GET") {
    await ensureSeed();
    const force = /[?&]refresh=1/.test(req.url || "");
    const [all, cal] = await Promise.all([loadAll(true), calendarEvents(force)]);
    const keys = new Set(all.flatMap((p) => [p.student.name, ...(p.tutor.calNames || [])].map(norm)));
    const unmatched = cal.events.filter((e) => !keys.has(norm(e.name)) && e.end > Date.now() - 14 * 86400e3);
    return ok(res, { students: all.map((p) => view(p, cal.events)), unmatched,
      calendar: { configured: cal.configured, at: cal.at || null, error: cal.error || null } });
  }
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const b = await readBody(req);
  const id = str(b.id, 40);
  const back = async (sid) => { const p = await loadStudent(sid, true); if (!p) return fail(res, 404, "Student not found"); const cal = await calendarEvents(false); return ok(res, { student: view(p, cal.events) }); };
  const tutorUpdate = (fn) => updateJSON(P.tutor(id), blankTutor(""), (t) => fn(upgradeTutor(t)));
  const studentUpdate = (fn) => updateJSON(P.student(id), null, (s) => (s ? fn(upgradeStudent(s)) : undefined));

  if (b.op === "addStudent") {
    const name = str(b.name, 80).trim(); if (!name) return fail(res, 400, "Add a name.");
    const nid = newId();
    await writeJSON(P.student(nid), blankStudent(name));
    const cal = (Array.isArray(b.calNames) ? b.calNames : [name]).map((n) => str(n, 80).trim()).filter(Boolean).slice(0, 5);
    await writeJSON(P.tutor(nid), { ...blankTutor(name), status: "Active", calNames: cal.length ? cal : [name] });
    return back(nid);
  }
  if (!id || !(await readJSON(P.student(id))).data) return fail(res, 404, "Student not found");

  switch (b.op) {
    case "deleteStudent": await removePrefix(`students/${id}/`); return ok(res, { deleted: id });
    case "profile":
      await studentUpdate((s) => { if (str(b.name, 80).trim()) s.name = str(b.name, 80).trim(); if (b.profile) s.profile = cleanProfile(b.profile, s.profile); return s; });
      if (Array.isArray(b.calNames)) await tutorUpdate((t) => { t.calNames = b.calNames.map((n) => str(n, 80).trim()).filter(Boolean).slice(0, 5); return t; });
      return back(id);
    case "tutor": {
      const p = b.patch || {};
      await tutorUpdate((t) => {
        if (STATUSES.includes(p.status)) t.status = p.status;
        if (typeof p.notes === "string") t.notes = str(p.notes, 10000);
        if (p.plan) t.plan = cleanPlan(p.plan);
        return t;
      });
      return back(id);
    }
    case "session": {
      const sid = str(b.sessionId, 200); if (!sid) return fail(res, 400, "Missing session");
      const patch = cleanSessionPatch(b.patch);
      const cal = await calendarEvents(false); const ev = cal.events.find((e) => e.id === sid);
      await tutorUpdate((t) => {
        const i = t.sessions.findIndex((x) => x.id === sid);
        if (i < 0) { if (!ev) throw Object.assign(new Error("That session isn't on the calendar any more."), { status: 404 }); t.sessions.push({ id: sid, start: ev.start, end: ev.end, kind: "skill", ...patch }); }
        else t.sessions[i] = { ...t.sessions[i], ...patch, ...(ev ? { start: ev.start, end: ev.end } : {}), updatedAt: Date.now() };
        return t;
      });
      return back(id);
    }
    case "addSession": {
      const d = str(b.date, 10), tm = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time : "16:00";
      const start = Date.parse(`${d}T${tm}:00${str(b.offset, 6) || "-08:00"}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(start)) return fail(res, 400, "Pick a date for the session.");
      const mins = Math.max(15, Math.min(300, Number(b.mins) || 60));
      const rec = { id: "m" + newId(), start, end: start + mins * 60e3, manual: true, kind: "skill", ...cleanSessionPatch(b.patch || {}) };
      await tutorUpdate((t) => { t.sessions.push(rec); return t; });
      const r = await loadStudent(id, true); const cal = await calendarEvents(false);
      return ok(res, { student: view(r, cal.events), sessionId: rec.id });
    }
    case "deleteSession":
      await tutorUpdate((t) => { t.sessions = t.sessions.filter((x) => x.id !== str(b.sessionId, 200)); return t; }); return back(id);
    case "addScore": { const sc = cleanScore(b.score); await studentUpdate((s) => { s.scores = [...s.scores, { ...sc, by: "tutor" }].slice(-100); return s; }); return back(id); }
    case "deleteScore": await studentUpdate((s) => { s.scores = s.scores.filter((x) => x.id !== str(b.scoreId, 40)); return s; }); return back(id);
    case "addQuestion": { const q = cleanQuestion(b.question, "tutor"); await tutorUpdate((t) => { t.questions = [...(t.questions || []), q].slice(-3000); return t; }); return back(id); }
    case "deleteQuestion": {
      const qid = str(b.qid, 40);
      await tutorUpdate((t) => { t.questions = (t.questions || []).filter((q) => q.id !== qid); return t; });
      await studentUpdate((s) => { const n = s.questions.filter((q) => q.id !== qid); if (n.length === s.questions.length) return undefined; s.questions = n; return s; });
      return back(id);
    }
    default: return fail(res, 400, "Unknown action");
  }
});
