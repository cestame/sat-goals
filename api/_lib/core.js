// Shared server helpers: responses, sessions, private storage, roster, names.
import crypto from "node:crypto";
import { get, put, list, del, BlobPreconditionFailedError } from "@vercel/blob";

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
  return { name: str(name, 80).trim(), createdAt: now(), profile: {}, questions: [] };
}
export function blankTutor(name) {
  return { status: "Active", calNames: name ? [name] : [], notes: "", rate: null, plan: { summary: "", steps: [] }, sessions: [], questions: [] };
}

const SEED = ["Una K.", "Riley Z.", "Mason D.", "Benjamin D.", "Adriana M.", "Bailee K."];
const SEED_CAL = { "Benjamin D.": ["Benjamin D"] };
export async function ensureSeed() {
  const { data } = await readJSON(P.seeded, null);
  if (data) return;
  const existing = await list({ prefix: "students/", limit: 5 });
  if (!existing.blobs.length) {
    for (const name of SEED) {
      const id = newId();
      await writeJSON(P.student(id), blankStudent(name));
      await writeJSON(P.tutor(id), { ...blankTutor(name), calNames: [name, ...(SEED_CAL[name] || [])] });
    }
  }
  await writeJSON(P.seeded, { at: now() });
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
  return withTutor ? { id, student: s.data, tutor: t.data || blankTutor(s.data.name) } : { id, student: s.data };
}
export async function loadAll(withTutor) {
  const ids = await studentIds();
  const all = await Promise.all(ids.map((id) => loadStudent(id, withTutor)));
  return all.filter(Boolean);
}

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

/* ---------- validation ---------- */
export const DOMAINS = {
  info: "Information & Ideas", craft: "Craft & Structure", expr: "Expression of Ideas", conv: "Standard English Conventions",
  alg: "Algebra", adv: "Advanced Math", psda: "Problem-Solving & Data Analysis", geo: "Geometry & Trigonometry",
  pace: "Pacing and timing", strat: "Strategy and guessing", nerves: "Test anxiety", desmos: "Using the Desmos calculator",
};
export const QDOMAINS = ["info", "craft", "expr", "conv", "alg", "adv", "psda", "geo"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const score = (v, lo, hi) => { if (v === "" || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
export function cleanProfile(o = {}) {
  const sc = o.scores || {};
  return {
    grade: str(o.grade, 20), school: str(o.school, 120), testDate: date(o.testDate), contact: str(o.contact, 160),
    scores: { rw: score(sc.rw, 200, 800), math: score(sc.math, 200, 800), source: str(sc.source, 60) },
    target: score(o.target, 400, 1600),
    focus: Array.isArray(o.focus) ? o.focus.filter((k) => DOMAINS[k]).slice(0, 20) : [],
    goals: Array.isArray(o.goals) ? o.goals.map((g) => str(g, 240).trim()).filter(Boolean).slice(0, 3) : [],
    hardest: str(o.hardest, 1500), extra: str(o.extra, 1500),
    days: Array.isArray(o.days) ? o.days.filter((d) => DAYS.includes(d)) : [], times: str(o.times, 200),
    updatedAt: now(),
  };
}
export function cleanQuestion(o = {}, by) {
  const section = o.section === "Math" ? "Math" : "RW";
  return {
    id: newId(), by, at: now(), date: date(o.date) || new Date().toISOString().slice(0, 10),
    section, domain: QDOMAINS.includes(o.domain) ? o.domain : "",
    source: str(o.source, 120).trim(), topic: str(o.topic, 200).trim(),
    difficulty: ["Easy", "Medium", "Hard"].includes(o.difficulty) ? o.difficulty : "",
    result: ["right", "wrong", "guessed", "skipped"].includes(o.result) ? o.result : "wrong",
    seconds: score(o.seconds, 0, 3600),
    note: str(o.note, 1000).trim(),
  };
}
export function cleanSession(o = {}) {
  return { id: newId(), date: date(o.date) || new Date().toISOString().slice(0, 10), mins: score(o.mins, 0, 600) || 0,
    topics: str(o.topics, 400).trim(), homework: str(o.homework, 400).trim(), score: score(o.score, 400, 1600), hwDone: false,
    calEventId: str(o.calEventId, 200) || undefined };
}
export function cleanPlan(p = {}) {
  return { summary: str(p.summary, 400),
    steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 20).map((s) => ({ id: str(s.id, 40) || newId(), title: str(s.title, 140), focus: str(s.focus, 500), done: !!s.done })),
    draftedAt: Number.isFinite(p.draftedAt) ? p.draftedAt : undefined };
}

export function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error(e); fail(res, e.status || 500, e.status ? e.message : "Something went wrong on the server. Try again."); }
  };
}
