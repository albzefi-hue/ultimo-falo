import { DurableObject } from "cloudflare:workers";

// Server dell'Ultimo Falò su Cloudflare: le pagine statiche arrivano da /public,
// tutto ciò che sta sotto /api/ passa a un unico Durable Object, il "mondo".
// Il mondo tiene in memoria chi è online e la chat, e salva su disco partite e classifica.

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GIFTABLE = ["cotta", "pescecotto", "verdure", "uova", "latte", "bacche", "carne", "legna"];
const PRESENCE_TTL = 10_000;
const EVENT_TTL = 5 * 60_000;
const RATE_LIMIT = 300; // richieste al minuto per indirizzo IP
const VILLAGE_KINDS = ["casa", "recinto", "orto", "pozzo", "lanterna", "trappola", "pollaio", "ovile", "stalla", "cuccia", "rifugio"];
const WORLD_PX = 2560;

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const bad = (error, status = 400) => json({ error }, status);

const cleanNick = (n) =>
  (typeof n === "string" ? n.replace(/[\u0000-\u001f<>&"']/g, "").replace(/\s+/g, " ").trim().slice(0, 16) : "") || "Esploratore";
const isCode = (c) => typeof c === "string" && /^FALO-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const int = (v, min, max) => (isNum(v) ? Math.max(min, Math.min(max, Math.round(v))) : min);

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return `FALO-${s.slice(0, 4)}-${s.slice(4)}`;
}

async function readJSON(req, limit) {
  const text = await req.text();
  if (text.length > limit) throw new RangeError("too large");
  return JSON.parse(text);
}

function cleanPresence(p) {
  if (!p || typeof p !== "object") return null;
  const out = {};
  for (const k of ["x", "y", "fc", "lv", "d", "mv", "dead"]) if (isNum(p[k])) out[k] = p[k];
  if (Array.isArray(p.f)) out.f = p.f.slice(0, 4).filter((q) => Array.isArray(q) && q.length === 3 && q.every(isNum));
  if (Array.isArray(p.g)) out.g = p.g.slice(0, 20).filter((v) => Number.isInteger(v));
  if (Array.isArray(p.pt)) out.pt = p.pt.slice(0, 12).filter((q) => Array.isArray(q) && q.length === 3 && q.every(isNum));
  return out;
}

function cleanEvent(e) {
  if (!e || typeof e !== "object") return null;
  if (e.topic === "chat" && e.data && typeof e.data.t === "string") {
    const t = e.data.t.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 140);
    return t ? { topic: "chat", data: { t } } : null;
  }
  if (e.topic === "gift" && e.data && typeof e.data.to === "string" && GIFTABLE.includes(e.data.item))
    return { topic: "gift", data: { to: e.data.to.slice(0, 20), item: e.data.item } };
  return null;
}

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.presence = new Map(); // id -> { nick, pres, t }
    this.events = []; // { k, ts, from, nick, topic, data }
    this.seq = 0;
    this.hits = new Map(); // ip -> { n, start }
    this.board = null;
    this.village = new Map(); // proprietario -> { nick, list: [[tipo, x, y]], at }
    this.bv = 1;
    ctx.blockConcurrencyWhile(async () => {
      this.village = new Map((await ctx.storage.get("village")) || []);
      this.bv = (await ctx.storage.get("bv")) || 1;
    });
  }

  async setVillage(owner, nick, raw) {
    const list = (Array.isArray(raw) ? raw : []).slice(0, 150)
      .filter((q) => Array.isArray(q) && VILLAGE_KINDS.includes(q[0]) && isNum(q[1]) && isNum(q[2]))
      .map((q) => [q[0], Math.max(0, Math.min(WORLD_PX, Math.round(q[1]))), Math.max(0, Math.min(WORLD_PX, Math.round(q[2])))]);
    const prev = this.village.get(owner);
    if (prev && prev.nick === nick && JSON.stringify(prev.list) === JSON.stringify(list)) return;
    if (list.length) this.village.set(owner, { nick, list, at: Date.now() });
    else this.village.delete(owner);
    if (this.village.size > 500) {
      const oldest = [...this.village].sort((a, b) => a[1].at - b[1].at).slice(0, this.village.size - 500);
      for (const [k] of oldest) this.village.delete(k);
    }
    this.bv++;
    await this.ctx.storage.put({ village: [...this.village], bv: this.bv });
  }

  limited(ip) {
    const now = Date.now();
    const h = this.hits.get(ip);
    if (!h || now - h.start > 60_000) { this.hits.set(ip, { n: 1, start: now }); return false; }
    h.n++;
    if (this.hits.size > 5000) this.hits.clear();
    return h.n > RATE_LIMIT;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\//, "");
    if (this.limited(req.headers.get("cf-connecting-ip") || "anon")) return bad("rate limited", 429);
    try {
      if (route === "save" && req.method === "POST") return await this.save(req);
      if (route === "load" && req.method === "GET") return await this.load(url);
      if (route === "score" && req.method === "POST") return await this.score(req);
      if (route === "scores" && req.method === "GET") return await this.scores(url);
      if (route === "sync" && req.method === "POST") return await this.sync(req);
      return bad("not found", 404);
    } catch (e) {
      if (e instanceof RangeError) return bad("too large", 413);
      if (e instanceof SyntaxError) return bad("invalid json");
      console.error(e);
      return bad("server error", 500);
    }
  }

  /* ---------- Salvataggi ---------- */

  async save(req) {
    const body = await readJSON(req, 1_500_000);
    const s = body && body.save;
    if (!s || typeof s.json !== "string") return bad("missing save");
    const rec = {
      save: { json: s.json, day: int(s.day, 1, 100000), hour: int(s.hour, 0, 23), level: int(s.level, 1, 1000), savedAt: Date.now() },
      nick: cleanNick(body.nick),
      at: Date.now(),
    };
    const storage = this.ctx.storage;
    if (isCode(body.code)) {
      await storage.put("save:" + body.code, rec);
      return json({ code: body.code });
    }
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await storage.get("save:" + code)) continue;
      await storage.put("save:" + code, rec);
      return json({ code });
    }
    return bad("retry", 503);
  }

  async load(url) {
    const code = (url.searchParams.get("code") || "").trim().toUpperCase();
    if (!isCode(code)) return bad("invalid code");
    const rec = await this.ctx.storage.get("save:" + code);
    if (!rec) return bad("not found", 404);
    return json({ save: rec.save, nick: rec.nick });
  }

  /* ---------- Classifica ---------- */

  async score(req) {
    const b = await readJSON(req, 4_000);
    if (!isCode(b.code)) return bad("invalid code");
    const storage = this.ctx.storage;
    if (!(await storage.get("save:" + b.code))) return bad("unknown code", 404);
    const days = int(b.days, 1, 100000);
    const prev = await storage.get("score:" + b.code);
    if (prev && prev.days >= days) return json({ best: prev.days });
    await storage.put("score:" + b.code, { nick: cleanNick(b.nick), days, level: int(b.level, 1, 1000), wolves: int(b.wolves, 0, 1e6), at: Date.now() });
    this.board = null;
    return json({ best: days });
  }

  async scores(url) {
    if (!this.board || Date.now() - this.board.at > 15_000) {
      const all = await this.ctx.storage.list({ prefix: "score:", limit: 2000 });
      const rows = [...all].map(([k, v]) => ({ k: k.slice(6), ...v }))
        .sort((a, b) => b.days - a.days || b.level - a.level || a.at - b.at).slice(0, 50);
      this.board = { at: Date.now(), rows };
    }
    const code = url.searchParams.get("code");
    return json({ rows: this.board.rows.slice(0, 20).map((r) => ({ nick: r.nick, days: r.days, level: r.level, wolves: r.wolves, me: r.k === code })) });
  }

  /* ---------- Bosco della comunità ---------- */

  async sync(req) {
    const b = await readJSON(req, 16_000);
    if (typeof b.id !== "string" || !/^[a-z0-9]{6,20}$/.test(b.id)) return bad("invalid id");
    const now = Date.now();
    const nick = cleanNick(b.nick);

    for (const [k, v] of this.presence) if (now - v.t > PRESENCE_TTL) this.presence.delete(k);
    if (b.leave) { this.presence.delete(b.id); return json({ ok: true }); }
    if (this.presence.size >= 80 && !this.presence.has(b.id)) return bad("room full", 503);
    this.presence.set(b.id, { nick, pres: cleanPresence(b.pres), t: now });

    const incoming = Array.isArray(b.events) ? b.events.slice(0, 5) : [];
    const owner = typeof b.owner === "string" && /^[a-z0-9]{6,20}$/.test(b.owner) ? b.owner : null;
    for (const e of incoming) {
      if (e && e.topic === "mybuilds" && owner && e.data) { await this.setVillage(owner, nick, e.data.list); continue; }
      const ev = cleanEvent(e);
      if (ev) this.events.push({ ...ev, k: `${now.toString(36)}-${(this.seq++).toString(36)}`, ts: now, from: b.id, nick });
    }
    while (this.events.length && (now - this.events[0].ts > EVENT_TTL || this.events.length > 300)) this.events.shift();

    const since = isNum(b.since) && b.since > 0 ? Math.max(b.since, now - 60_000) : now - 20_000;
    const events = this.events.filter((e) => e.ts >= since).slice(-40);
    const peers = [...this.presence].map(([id, v]) => ({ id, nick: v.nick, pres: v.pres }));
    const out = { now, peers, events, bv: this.bv };
    if (b.bv !== this.bv) out.builds = [...this.village].map(([o, v]) => ({ owner: o, nick: v.nick, list: v.list }));
    return json(out);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return env.WORLD.get(env.WORLD.idFromName("world")).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
