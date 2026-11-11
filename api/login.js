import { handler, readBody, ok, fail, setSession, clearSession, getSession, safeEqual, norm, ensureSeed, loadAll, matchName,
  writeJSON, P, blankStudent, blankTutor, newId, str } from "./_lib/core.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default handler(async (req, res) => {
  if (req.method === "GET") {           // who am I?
    const s = getSession(req);
    return ok(res, s ? { role: s.r === "t" ? "tutor" : "student", name: s.n || "" } : { role: null });
  }
  if (req.method === "DELETE") { clearSession(res); return ok(res); }
  if (req.method !== "POST") return fail(res, 405, "Use POST");

  const body = await readBody(req);
  const name = str(body.name, 80).trim();
  if (!name) return fail(res, 400, "Type your name.");

  if (body.role === "tutor") {
    const want = process.env.TUTOR_PASSWORD, tutorName = process.env.TUTOR_NAME || "";
    if (!want) return fail(res, 500, "The tutor password isn't set up on the server yet.");
    const n = norm(name), t = norm(tutorName);
    const nameOk = !t || n === t || n.split(" ")[0] === t.split(" ")[0];
    if (!nameOk || !safeEqual(str(body.password, 200), want)) { await wait(700); return fail(res, 401, "That name and password don't match."); }
    setSession(res, { r: "t", n: tutorName || name }, 14);
    return ok(res, { role: "tutor" });
  }

  // student: name only
  await ensureSeed();
  const all = await loadAll(true);
  const people = all.map((p) => ({ id: p.id, name: p.student.name, calNames: p.tutor.calNames || [], status: p.tutor.status }));
  const found = matchName(name, people).filter((p) => p.status !== "Done");
  if (found.length === 1) {
    setSession(res, { r: "s", id: found[0].id, n: found[0].name }, 30);
    return ok(res, { role: "student", name: found[0].name });
  }
  if (found.length > 1) return fail(res, 409, "More than one student has that first name. Add your last initial, like “Riley Z.”");
  if (!body.create) return ok(res, { notFound: true });
  if (name.split(/\s+/).length < 2) return fail(res, 400, "Add your last name or last initial, like “Jordan P.”");
  const id = newId();
  await writeJSON(P.student(id), blankStudent(name));
  await writeJSON(P.tutor(id), { ...blankTutor(name), status: "New" });
  setSession(res, { r: "s", id, n: name }, 30);
  return ok(res, { role: "student", name, created: true });
});
