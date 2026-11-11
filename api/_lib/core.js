// Shared server helpers: responses, sessions, private storage, roster, names.
import crypto from "node:crypto";
import { get, put, list, del, BlobPreconditionFailedError } from "@vercel/blob";
import { parseICS } from "./ics.js";

/* ---------- responses ---------- */
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
export const ok = (res, body = { ok: true }) => send(res, 200, body);
export const fail = (res, status, error) => send(res, status, { error });

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 200_000) throw Object.assign(new Error("Too large"), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

/* ---------- sessions (signed cookie) ---------- */
const COOKIE = "satsess";
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error("Server is missing SESSION_SECRET"), { status: 500 });
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
export function setSession(res, data, days = 30) {
  const token = sign({ ...data, exp: Date.now() + days * 86400e3 });
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
export function getSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  return m ? verify(m.slice(COOKIE.length + 1)) : null;
}
export function requireTutor(req, res) {
  const s = getSession(req);
  if (!s || s.r !== "t") { fail(res, 401, "Please log in as the tutor."); return null; }
  return s;
}
export function requireStudent(req, res) {
  const s = getSession(req);
  if (!s || s.r !== "s" || !s.id) { fail(res, 401, "Please log in with your name."); return null; }
  return s;
}
export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------- private storage ---------- */
const OPTS = { access: "private" };
async function streamToString(stream) {
  const reader = stream.getReader(); const parts = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(Buffer.from(value)); }
  return Buffer.concat(parts).toString("utf8");
}
export async function readJSON(path, fallback = null) {
  let r;
  try { r = await get(path, { ...OPTS, useCache: false }); }
  catch (e) { if (e?.name === "BlobNotFoundError" || /not.?found/i.test(e?.message || "")) return { data: fallback, etag: null }; throw e; }
  if (!r || r.statusCode !== 200 || !r.stream) return { data: fallback, etag: null };
  return { data: JSON.parse(await streamToString(r.stream)), etag: r.blob.etag };
}
export async function writeJSON(path, data, etag) {
  const opts = { ...OPTS, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
  if (etag) opts.ifMatch = etag;
  return put(path, JSON.stringify(data), opts);
}
/** Read, change, write, with one retry if someone else wrote in between. */
export async function updateJSON(path, fallback, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, etag } = await readJSON(path, fallback);
    const next = await fn(structuredClone(data ?? fallback));
    if (next === undefined) return data;
    try { await writeJSON(path, next, etag); return next; }
    catch (e) { if (e instanceof BlobPreconditionFailedError || e?.name === "BlobPreconditionFailedError") continue; throw e; }
  }
  throw Object.assign(new Error("Someone else was saving at the same moment. Try again."), { status: 409 });
}
export async function removePrefix(prefix) {
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    if (r.blobs.length) await del(r.blobs.map((b) => b.url));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
}

/* ---------- students ---------- */
export const P = {
  student: (id) => `students/${id}/student.json`,
  tutor: (id) => `students/${id}/tutor.json`,
  prep: "meta/prep.json",
  seeded: "meta/seeded.json",
};
export const norm = (s) => String(s || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
export const newId = () => crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
export const str = (v, max = 600) => (typeof v === "string" ? v.slice(0, max) : "");
export const now = () => Date.now();

export function blankStudent(name) {
  return { name: str(name, 80).trim(), createdAt: now(), profile: { goals: [] }, scores: [], questions: [], hw: {} };
}
export function blankTutor(name) {
  return { status: "Active", calNames: name ? [name] : [], notes: "", plan: { summary: "", steps: [] }, sessions: [], questions: [] };
}

/* Roster changes are applied once each, in order. */
const ROSTER_VERSIONS = [
  { v: 1, add: [["Una K."], ["Riley Z."], ["Mason D."], ["Benjamin D.", "Benjamin D"], ["Adriana M."], ["Bailee K."]] },
  { v: 2, add: [["Phuong"]] },
];
export async function ensureSeed() {
  const { data, etag } = await readJSON(P.seeded, null);
  const have = data?.v ?? (data ? 1 : 0);
  const todo = ROSTER_VERSIONS.filter((r) => r.v > have);
  if (!todo.length) return;
  const existing = await loadAll(true);
  const names = existing.flatMap((p) => [p.student.name, ...(p.tutor.calNames || [])].map(norm));
  for (const r of todo) {
    for (const [name, ...alts] of r.add) {
      if (names.includes(norm(name))) continue;
      const id = newId();
      await writeJSON(P.student(id), blankStudent(name));
      await writeJSON(P.tutor(id), { ...blankTutor(name), calNames: [name, ...alts] });
      names.push(norm(name));
    }
  }
  try { await writeJSON(P.seeded, { v: ROSTER_VERSIONS.at(-1).v, at: now() }, etag); } catch {}
}

export async function studentIds() {
  const ids = new Set(); let cursor;
  do {
    const r = await list({ prefix: "students/", cursor, limit: 1000 });
    for (const b of r.blobs) { const m = b.pathname.match(/^students\/([^/]+)\/student\.json$/); if (m) ids.add(m[1]); }
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return [...ids];
}
export async function loadStudent(id, withTutor) {
  const [s, t] = await Promise.all([readJSON(P.student(id), null), withTutor ? readJSON(P.tutor(id), null) : Promise.resolve({ data: null })]);
  if (!s.data) return null;
  return { id, student: upgradeStudent(s.data), tutor: upgradeTutor(t.data || blankTutor(s.data.name)) };
}
export async function loadAll(withTutor) {
  const ids = await studentIds();
  return (await Promise.all(ids.map((id) => loadStudent(id, withTutor)))).filter(Boolean);
}

/** Bring older saved data up to the current shape (read-time only). */
export function upgradeStudent(s) {
  s = { ...s, profile: { ...(s.profile || {}) }, scores: [...(s.scores || [])], questions: s.questions || [], hw: s.hw || {} };
  const g = s.profile.goals;
  s.profile.goals = Array.isArray(g) ? g.map((x) => (typeof x === "string" ? { id: hashId(x), text: x, done: false } : x)).filter((x) => x && x.text) : [];
  const old = s.profile.scores;
  if (old && (old.rw || old.math) && !s.scores.length) s.scores.push({ id: "initial", date: "", type: old.source || "Earlier score", rw: old.rw || null, math: old.math || null });
  return s;
}
export function upgradeTutor(t) {
  t = { ...blankTutor(""), ...t };
  t.sessions = (t.sessions || []).map((x) => (x.start || x.notes !== undefined ? x : {
    id: x.calEventId || x.id, start: x.date ? Date.parse(x.date + "T17:00:00Z") : null, end: null, kind: "skill",
    notes: x.topics || "", homework: x.homework || "", practiceScore: x.score || null, manual: !x.calEventId,
  }));
  return t;
}
function hashId(s) { return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 8); }

/** Find students whose name matches what someone typed on the login page. */
export function matchName(typed, people) {
  const t = norm(typed).split(" ").filter(Boolean);
  if (!t.length) return [];
  const exact = people.filter((p) => [p.name, ...(p.calNames || [])].some((n) => norm(n) === t.join(" ")));
  if (exact.length) return exact;
  return people.filter((p) => [p.name, ...(p.calNames || [])].some((n) => {
    const c = norm(n).split(" ");
    if (c[0] !== t[0]) return false;
    if (t.length === 1 || c.length === 1) return true;
    return t[1][0] === c[1][0];
  }));
}

/* ---------- calendar ---------- */
let calCache = { at: 0, events: null, error: null };
export async function calendarEvents(force) {
  const url = process.env.GCAL_ICS_URL;
  if (!url) return { configured: false, events: [] };
  if (!force && calCache.events && Date.now() - calCache.at < 3 * 60e3) return { configured: true, events: calCache.events, at: calCache.at };
  try {
    const r = await fetch(url, { headers: { "User-Agent": "sat-tutoring-site" } });
    if (!r.ok) throw new Error(`Google Calendar answered ${r.status}`);
    const all = parseICS(await r.text(), Date.now() - 400 * 86400e3, Date.now() + 120 * 86400e3);
    const events = all.map((e) => { const m = e.summary.match(/^\s*SAT\s*[-–—:]\s*(.+?)\s*$/i); return m ? { id: e.id, name: m[1], start: e.start, end: e.end } : null; }).filter(Boolean);
    calCache = { at: Date.now(), events, error: null };
    return { configured: true, events, at: calCache.at };
  } catch (e) {
    if (calCache.events) return { configured: true, events: calCache.events, at: calCache.at, error: "Showing the last copy of your calendar: " + e.message };
    return { configured: true, events: [], error: "Couldn't read your calendar: " + e.message };
  }
}
export function eventsFor(person, events) {
  const keys = [person.student.name, ...(person.tutor.calNames || [])].map(norm);
  return events.filter((e) => keys.includes(norm(e.name)));
}
/** Calendar events + saved session records, newest last. */
export function mergeSessions(person, events) {
  const recs = new Map((person.tutor.sessions || []).map((r) => [r.id, r]));
  const out = [];
  for (const ev of eventsFor(person, events)) {
    const r = recs.get(ev.id) || {}; recs.delete(ev.id);
    out.push({ kind: "skill", ...r, id: ev.id, start: ev.start, end: ev.end, calendar: true });
  }
  for (const r of recs.values()) if (r.start) out.push({ kind: "skill", ...r, calendar: false });
  return out.sort((a, b) => a.start - b.start);
}
export function studentSafeSession(s, hw) {
  const { privateNote, prepared, ...rest } = s;
  return { ...rest, hwDone: !!(hw && hw[s.id]) };
}

/* ---------- validation ---------- */
export const CATEGORIES = {
  info: { section: "RW", name: "Information and Ideas", skills: ["Central Ideas and Details", "Command of Evidence: Textual", "Command of Evidence: Quantitative", "Inferences"] },
  craft: { section: "RW", name: "Craft and Structure", skills: ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"] },
  expr: { section: "RW", name: "Expression of Ideas", skills: ["Rhetorical Synthesis", "Transitions"] },
  conv: { section: "RW", name: "Standard English Conventions", skills: ["Boundaries", "Form, Structure, and Sense"] },
  alg: { section: "Math", name: "Algebra", skills: ["Linear equations in one variable", "Linear functions", "Linear equations in two variables", "Systems of two linear equations in two variables", "Linear inequalities in one or two variables"] },
  adv: { section: "Math", name: "Advanced Math", skills: ["Nonlinear functions", "Nonlinear equations in one variable and systems of equations in two variables", "Equivalent expressions"] },
  psda: { section: "Math", name: "Problem-Solving and Data Analysis", skills: ["Ratios, rates, proportional relationships, and units", "Percentages", "One-variable data: distributions and measures of center and spread", "Two-variable data: models and scatterplots", "Probability and conditional probability", "Inference from sample statistics and margin of error", "Evaluating statistical claims: observational studies and experiments"] },
  geo: { section: "Math", name: "Geometry and Trigonometry", skills: ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"] },
};
export const DOMAINS = Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.name]));
const KINDS = ["diagnostic", "skill", "test-review", "other"];
const score = (v, lo, hi) => { if (v === "" || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
const cat = (v) => (CATEGORIES[v] ? v : "");
const skillOf = (c, v) => (c && CATEGORIES[c].skills.includes(v) ? v : "");

export function cleanGoals(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((g) => ({ id: str(g.id, 20) || newId(), text: str(g.text, 240).trim(), done: !!g.done })).filter((g) => g.text);
}
export function cleanProfile(o = {}, prev = {}) {
  const p = { ...prev };
  if ("goals" in o) p.goals = cleanGoals(o.goals);
  if ("testDate" in o) p.testDate = date(o.testDate);
  if ("target" in o) p.target = score(o.target, 400, 1600);
  if ("grade" in o) p.grade = str(o.grade, 20);
  if ("school" in o) p.school = str(o.school, 120);
  if ("contact" in o) p.contact = str(o.contact, 160);
  if ("about" in o) p.about = str(o.about, 1500);
  p.updatedAt = now();
  return p;
}
export function cleanScore(o = {}) {
  const rw = score(o.rw, 200, 800), math = score(o.math, 200, 800);
  const total = rw && math ? rw + math : score(o.total, 400, 1600);
  if (!rw && !math && !total) throw Object.assign(new Error("Add at least one score."), { status: 400 });
  return { id: newId(), date: date(o.date), type: str(o.type, 60) || "Practice test", rw, math, total, at: now() };
}
export function cleanQuestion(o = {}, by) {
  const c = cat(o.category ?? o.domain);
  const section = c ? CATEGORIES[c].section : (o.section === "Math" ? "Math" : "RW");
  return {
    id: newId(), by, at: now(), date: date(o.date) || new Date().toISOString().slice(0, 10),
    qid: str(o.qid, 40).trim(), section, category: c, skill: skillOf(c, o.skill),
    source: str(o.source, 120).trim(), topic: str(o.topic, 200).trim(),
    difficulty: ["Easy", "Medium", "Hard"].includes(o.difficulty) ? o.difficulty : "",
    result: ["right", "wrong", "guessed", "skipped"].includes(o.result) ? o.result : "wrong",
    note: str(o.note, 1000).trim(), sessionId: str(o.sessionId, 200) || undefined,
  };
}
/** Fields the tutor can change on a session. */
export function cleanSessionPatch(p = {}) {
  const out = {};
  if ("kind" in p) out.kind = KINDS.includes(p.kind) ? p.kind : "skill";
  if ("category" in p) { out.category = cat(p.category); out.skill = skillOf(out.category, p.skill); }
  if ("title" in p) out.title = str(p.title, 120);
  if ("agenda" in p) out.agenda = str(p.agenda, 6000);
  if ("notes" in p) out.notes = str(p.notes, 20000);
  if ("homework" in p) out.homework = str(p.homework, 2000);
  if ("privateNote" in p) out.privateNote = str(p.privateNote, 4000);
  if ("prepared" in p) out.prepared = !!p.prepared;
  if ("cancelled" in p) out.cancelled = !!p.cancelled;
  if ("practiceScore" in p) out.practiceScore = score(p.practiceScore, 400, 1600);
  return out;
}
export function cleanPlan(p = {}) {
  return { summary: str(p.summary, 400),
    steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 20).map((s) => ({ id: str(s.id, 40) || newId(), title: str(s.title, 140), focus: str(s.focus, 500), done: !!s.done })) };
}

export function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error(e); fail(res, e.status || 500, e.status ? e.message : "Something went wrong on the server. Try again."); }
  };
}
