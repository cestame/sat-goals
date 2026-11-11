// Everything a logged-in student can do. The student id comes only from their signed cookie.
import { handler, readBody, ok, fail, requireStudent, readJSON, updateJSON, P, cleanProfile, cleanQuestion, str } from "./_lib/core.js";

const publicView = (id, s, t) => ({
  id, name: s.name, profile: s.profile || {},
  questions: [...(s.questions || []), ...((t && t.questions) || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at)),
});

export default handler(async (req, res) => {
  const sess = requireStudent(req, res); if (!sess) return;
  const id = sess.id;
  if (req.method === "GET") {
    const [{ data: s }, { data: t }] = await Promise.all([readJSON(P.student(id)), readJSON(P.tutor(id))]);
    if (!s) return fail(res, 401, "We couldn't find your profile. Log in again.");
    return ok(res, publicView(id, s, t));
  }
  if (req.method !== "POST") return fail(res, 405, "Use POST");
  const body = await readBody(req);
  const exists = (await readJSON(P.student(id))).data; if (!exists) return fail(res, 401, "Log in again.");
  let next;
  switch (body.op) {
    case "profile":
      next = await updateJSON(P.student(id), null, (s) => { s.profile = cleanProfile(body.profile); return s; }); break;
    case "addQuestion": {
      const q = cleanQuestion(body.question, "student");
      next = await updateJSON(P.student(id), null, (s) => { s.questions = [...(s.questions || []), q].slice(-3000); return s; }); break;
    }
    case "deleteQuestion": {
      const qid = str(body.id, 40);
      next = await updateJSON(P.student(id), null, (s) => { s.questions = (s.questions || []).filter((q) => q.id !== qid); return s; }); break;
    }
    default: return fail(res, 400, "Unknown action");
  }
  const { data: t } = await readJSON(P.tutor(id));
  return ok(res, publicView(id, next, t));
});
