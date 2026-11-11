// Tutor-only: everything about every student. Requires the tutor's signed cookie.
import { handler, readBody, ok, fail, requireTutor, ensureSeed, loadAll, loadStudent, readJSON, writeJSON, updateJSON, removePrefix,
  P, blankStudent, blankTutor, newId, str, cleanProfile, cleanQuestion, cleanSession, cleanPlan } from "./_lib/core.js";

const view = (p) => ({ id: p.id, name: p.student.name, createdAt: p.student.createdAt, profile: p.student.profile || {},
  studentQuestions: p.student.questions || [], ...p.tutor });
const STATUSES = ["New", "Active", "Paused", "Done"];

export default handler(async (req, res) => {
  if (!requireTutor(req, res)) return;
  if (req.method === "GET") {
    await ensureSeed();
    const [all, prep] = await Promise.all([loadAll(true), readJSON(P.prep, {})]);
    return ok(res, { students: all.map(view), prep: prep.data || {},
      features: { ai: !!process.env.ANTHROPIC_API_KEY, calendar: !!process.env.GCAL_ICS_URL } });
  }
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const b = await readBody(req);
  const id = str(b.id, 40);
  const back = async (sid) => { const p = await loadStudent(sid, true); return p ? ok(res, { student: view(p) }) : fail(res, 404, "Student not found"); };
  const tutorUpdate = (fn) => updateJSON(P.tutor(id), blankTutor(""), fn);
  const studentUpdate = (fn) => updateJSON(P.student(id), null, (s) => (s ? fn(s) : undefined));

  if (b.op === "addStudent") {
    const name = str(b.name, 80).trim(); if (!name) return fail(res, 400, "Add a name.");
    const nid = newId();
    await writeJSON(P.student(nid), { ...blankStudent(name), profile: b.profile ? cleanProfile(b.profile) : {} });
    await writeJSON(P.tutor(nid), { ...blankTutor(name), status: "New", calNames: Array.isArray(b.calNames) ? b.calNames.map((n) => str(n, 80)).filter(Boolean).slice(0, 5) : [name] });
    return back(nid);
  }
  if (b.op === "prep") {
    const ev = str(b.eventId, 200); if (!ev) return fail(res, 400, "Missing session");
    const next = await updateJSON(P.prep, {}, (all) => { all[ev] = { ...(all[ev] || {}), ...(typeof b.prepared === "boolean" ? { prepared: b.prepared } : {}), updatedAt: Date.now() }; return all; });
    return ok(res, { prep: next });
  }
  if (!id || !(await readJSON(P.student(id))).data) return fail(res, 404, "Student not found");

  switch (b.op) {
    case "deleteStudent": await removePrefix(`students/${id}/`); return ok(res, { deleted: id });
    case "profile":
      await studentUpdate((s) => { if (b.name && str(b.name, 80).trim()) s.name = str(b.name, 80).trim(); if (b.profile) s.profile = cleanProfile(b.profile); return s; });
      if (Array.isArray(b.calNames)) await tutorUpdate((t) => { t.calNames = b.calNames.map((n) => str(n, 80).trim()).filter(Boolean).slice(0, 5); return t; });
      return back(id);
    case "tutor": {
      const p = b.patch || {};
      await tutorUpdate((t) => {
        if (STATUSES.includes(p.status)) t.status = p.status;
        if (typeof p.notes === "string") t.notes = str(p.notes, 8000);
        if ("rate" in p) t.rate = p.rate === null || p.rate === "" ? null : Math.max(0, Math.min(1000, Number(p.rate) || 0));
        if (p.plan) t.plan = cleanPlan(p.plan);
        return t;
      });
      return back(id);
    }
    case "addSession": {
      const s = cleanSession(b.session);
      await tutorUpdate((t) => { t.sessions = [...(t.sessions || []), s]; if (t.status === "New") t.status = "Active"; return t; }); return back(id);
    }
    case "sessionHw":
      await tutorUpdate((t) => { t.sessions = (t.sessions || []).map((s) => (s.id === b.sid ? { ...s, hwDone: !!b.hwDone } : s)); return t; }); return back(id);
    case "deleteSession":
      await tutorUpdate((t) => { t.sessions = (t.sessions || []).filter((s) => s.id !== b.sid); return t; }); return back(id);
    case "addQuestion": {
      const q = cleanQuestion(b.question, "tutor");
      await tutorUpdate((t) => { t.questions = [...(t.questions || []), q].slice(-3000); return t; }); return back(id);
    }
    case "deleteQuestion": {
      const qid = str(b.qid, 40);
      await tutorUpdate((t) => { t.questions = (t.questions || []).filter((q) => q.id !== qid); return t; });
      await studentUpdate((s) => { const n = (s.questions || []).filter((q) => q.id !== qid); if (n.length === (s.questions || []).length) return undefined; s.questions = n; return s; });
      return back(id);
    }
    default: return fail(res, 400, "Unknown action");
  }
});
