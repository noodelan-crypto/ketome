/**
 * KetoMe Server — Cloudflare Worker
 * Routes:
 *   POST /image          { image }        → analyze meal photo (AI)
 *   POST /lookup         { query }        → nutrition lookup by text (AI + cache)
 *   POST /libre          { image, token } → analyze CGM screenshot
 *   POST /insights       { prompt }       → free-form AI insights (daily analysis)
 *   POST /auth/register  { user, pass, email } → register, returns token
 *   POST /auth/login     { user, pass }   → login, returns token
 *   POST /auth/set-email { token, email } → attach email to existing account
 *   POST /auth/forgot-username { email }  → emails username
 *   POST /auth/forgot-password { email }  → emails reset code
 *   POST /auth/reset-password { email, code, newPass } → set new password
 *   POST /data/save      { token, data }  → save user data
 *   POST /data/load      { token }        → load user data
 *   GET  /version                         → self-check: confirms what's actually deployed
 * Passwords: PBKDF2 hash (100k iterations) — never plaintext.
 * All AI routes rate-limited to 50 calls/day per account (or per IP if not logged in).
 */

const MODEL = "claude-sonnet-4-6";
const DAILY_AI_LIMIT = 50;
const WORKER_VERSION = "1.1.0"; // מזהה גרסת השרת — לאימות שהפריסה בפועל תואמת את מה שהודבק

const IMAGE_PROMPT = `אתה מנתח תזונה לדיאטה קטוגנית. זהה את המנה בתמונה והערך כמויות לפי גודל המנה הנראה.
החזר אך ורק JSON תקין, בלי Markdown:
{"name":"שם המנה בעברית","carbs":גרם פחמימות נטו,"cal":קלוריות,"protein":גרם חלבון,"fat":גרם שומן,"keto":true/false,"note":"משפט קצר בעברית"}
אם אין אוכל: {"error":"לא זוהתה מנת אוכל"}`;

const LOOKUP_PROMPT = (q) => `אתה מאגר ערכים תזונתיים. עבור המזון והכמות: "${q}"
החזר אך ורק JSON תקין, בלי Markdown:
{"name":"שם + כמות בעברית","carbs":גרם פחמימות נטו לכמות שצוינה,"cal":קלוריות,"protein":חלבון,"fat":שומן,"keto":true/false}
אם הכמות לא צוינה — הנח מנה ממוצעת. אם לא מזוהה מזון: {"error":"לא זוהה"}`;

const LIBRE_PROMPT = `בתמונה צילום מסך מאפליקציית חיישן סוכר רציף (FreeStyle Libre או דומה).
חלץ והחזר אך ורק JSON תקין, בלי Markdown:
{"glucose_now":מספר mg/dL נוכחי,"trend":"עולה"/"יורד"/"יציב","period":"טווח השעות המוצג","pattern":"2-3 משפטים בעברית: מהלך הגרף, עליות/ירידות בולטות והשעות שלהן","in_range":true/false}
אם זו לא תמונת חיישן: {"error":"לא זוהה צילום חיישן"}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const bufToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBuf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));

async function hashPass(pass, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBuf(saltHex), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return bufToHex(bits);
}

async function authUser(env, token) {
  if (!env.CACHE || !token) return null;
  return env.CACHE.get("token:" + token);
}

async function callClaude(env, content) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Anthropic API error");
  const text = (data.content || []).map((i) => i.text || "").join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function sendEmail(env, to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "onboarding@resend.dev", to, subject, html }),
  });
  if (!r.ok) throw new Error("שליחת המייל נכשלה: " + (await r.text()));
}

async function usersForEmail(env, email) {
  const raw = await env.CACHE.get("email:" + email.toLowerCase().trim());
  return raw ? JSON.parse(raw) : [];
}
async function addEmailIndex(env, email, user) {
  const key = "email:" + email.toLowerCase().trim();
  const list = await usersForEmail(env, email);
  if (!list.includes(user)) list.push(user);
  await env.CACHE.put(key, JSON.stringify(list));
}

/* ─── הגבלת קצב: N קריאות AI ביום, לפי משתמש מחובר או IP ─── */
async function checkRateLimit(env, request, token) {
  if (!env.CACHE) return true;
  const user = token ? await authUser(env, token) : null;
  const bucket = user ? "user:" + user : "ip:" + (request.headers.get("cf-connecting-ip") || "anon");
  const day = new Date().toISOString().slice(0, 10);
  const key = "rl:" + bucket + ":" + day;
  const count = parseInt((await env.CACHE.get(key)) || "0", 10);
  if (count >= DAILY_AI_LIMIT) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const urlEarly = new URL(request.url);
    /* GET /version — בדיקה מהירה בדפדפן שהפריסה בפועל תואמת את מה שהודבק, בלי צורך ב-Ctrl+F ב-GitHub */
    if (request.method === "GET" && urlEarly.pathname === "/version") {
      return json({
        worker: "ketome",
        version: WORKER_VERSION,
        hasInsightsRoute: true,
        hasRateLimit: true,
        dailyAiLimit: DAILY_AI_LIMIT,
        deployedAt: new Date().toISOString(),
      });
    }

    if (request.method !== "POST") return json({ error: "POST only — לבדיקת גרסה בלבד: GET /version" }, 405);

    const url = new URL(request.url);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    try {
      const aiRoutes = ["/image", "/lookup", "/libre", "/insights"];
      if (aiRoutes.includes(url.pathname)) {
        const ok = await checkRateLimit(env, request, body.token);
        if (!ok) return json({ error: `הגעת למכסת ${DAILY_AI_LIMIT} ניתוחי AI ליום. נסה שוב מחר.` }, 429);
      }

      /* ─── POST /image ─── */
      if (url.pathname === "/image") {
        if (!body.image) return json({ error: "missing image (base64)" }, 400);
        const result = await callClaude(env, [
          { type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image } },
          { type: "text", text: IMAGE_PROMPT },
        ]);
        return json(result);
      }

      /* ─── POST /lookup ─── */
      if (url.pathname === "/lookup") {
        const q = (body.query || "").trim();
        if (!q) return json({ error: "missing query" }, 400);
        const cacheKey = "lookup:" + q.toLowerCase();
        if (env.CACHE) {
          const cached = await env.CACHE.get(cacheKey);
          if (cached) return json(JSON.parse(cached));
        }
        const result = await callClaude(env, LOOKUP_PROMPT(q));
        if (env.CACHE && !result.error) {
          await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 180 });
        }
        return json(result);
      }

      /* ─── POST /libre ─── */
      if (url.pathname === "/libre") {
        if (!body.image) return json({ error: "missing image (base64)" }, 400);
        const result = await callClaude(env, [
          { type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image } },
          { type: "text", text: LIBRE_PROMPT },
        ]);
        if (env.CACHE && body.token && !result.error) {
          const user = await authUser(env, body.token);
          if (user) {
            const key = "libre:" + user;
            const log = JSON.parse((await env.CACHE.get(key)) || "[]");
            log.unshift({ ts: Date.now(), ...result });
            await env.CACHE.put(key, JSON.stringify(log.slice(0, 200)));
          }
        }
        return json(result);
      }

      /* ─── POST /insights — ניתוח AI חופשי (טקסט בלבד, לא JSON) ─── */
      if (url.pathname === "/insights") {
        if (!body.prompt) return json({ error: "missing prompt" }, 400);
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: "user", content: body.prompt }] }),
        });
        const data = await r.json();
        if (data.error) return json({ error: data.error.message || "Anthropic API error" }, 500);
        const text = (data.content || []).map((i) => i.text || "").join("\n");
        return json({ text });
      }

      /* ─── POST /auth/register ─── */
      if (url.pathname === "/auth/register") {
        if (!env.CACHE) return json({ error: "יש להגדיר KV Namespace בשם CACHE" }, 500);
        const user = (body.user || "").trim().toLowerCase();
        const pass = body.pass || "";
        const email = (body.email || "").trim().toLowerCase();
        if (user.length < 2 || pass.length < 4) return json({ error: "שם משתמש (2+) וסיסמה (4+ תווים) נדרשים" }, 400);
        if (!email || !email.includes("@")) return json({ error: "כתובת אימייל תקינה נדרשת" }, 400);
        if (await env.CACHE.get("user:" + user)) return json({ error: "שם המשתמש כבר תפוס" }, 409);
        const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const hash = await hashPass(pass, salt);
        await env.CACHE.put("user:" + user, JSON.stringify({ salt, hash, email, created: Date.now() }));
        await addEmailIndex(env, email, user);
        const token = crypto.randomUUID();
        await env.CACHE.put("token:" + token, user, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, token, user });
      }

      /* ─── POST /auth/login ─── */
      if (url.pathname === "/auth/login") {
        if (!env.CACHE) return json({ error: "יש להגדיר KV Namespace בשם CACHE" }, 500);
        const user = (body.user || "").trim().toLowerCase();
        const rec = await env.CACHE.get("user:" + user);
        if (!rec) return json({ error: "משתמש לא נמצא" }, 404);
        const { salt, hash } = JSON.parse(rec);
        if ((await hashPass(body.pass || "", salt)) !== hash) return json({ error: "סיסמה שגויה" }, 401);
        const token = crypto.randomUUID();
        await env.CACHE.put("token:" + token, user, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, token, user });
      }

      /* ─── POST /auth/set-email ─── */
      if (url.pathname === "/auth/set-email") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        const email = (body.email || "").trim().toLowerCase();
        if (!email || !email.includes("@")) return json({ error: "כתובת אימייל תקינה נדרשת" }, 400);
        const rec = await env.CACHE.get("user:" + user);
        if (!rec) return json({ error: "משתמש לא נמצא" }, 404);
        const parsed = JSON.parse(rec);
        await env.CACHE.put("user:" + user, JSON.stringify({ ...parsed, email }));
        await addEmailIndex(env, email, user);
        return json({ ok: true });
      }

      /* ─── POST /auth/forgot-username ─── */
      if (url.pathname === "/auth/forgot-username") {
        const email = (body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "כתובת אימייל נדרשת" }, 400);
        const users = await usersForEmail(env, email);
        if (users.length) {
          await sendEmail(env, email, "שם המשתמש שלך ב-KetoMe",
            `<p>שלום,</p><p>שם/שמות המשתמש הרשומים באימייל זה:</p><ul>${users.map(u => `<li><b>${u}</b></li>`).join("")}</ul>`);
        }
        return json({ ok: true });
      }

      /* ─── POST /auth/forgot-password ─── */
      if (url.pathname === "/auth/forgot-password") {
        const email = (body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "כתובת אימייל נדרשת" }, 400);
        const users = await usersForEmail(env, email);
        if (users.length) {
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          await env.CACHE.put("reset:" + email, JSON.stringify({ code, users }), { expirationTtl: 60 * 30 });
          await sendEmail(env, email, "איפוס סיסמה ב-KetoMe",
            `<p>שלום,</p><p>קוד לאיפוס הסיסמה שלך: <b style="font-size:20px">${code}</b></p><p>הקוד בתוקף ל-30 דקות.</p>`);
        }
        return json({ ok: true });
      }

      /* ─── POST /auth/reset-password ─── */
      if (url.pathname === "/auth/reset-password") {
        const email = (body.email || "").trim().toLowerCase();
        const code = (body.code || "").trim();
        const newPass = body.newPass || "";
        if (!email || !code || newPass.length < 4) return json({ error: "נדרשים אימייל, קוד וסיסמה חדשה (4+ תווים)" }, 400);
        const raw = await env.CACHE.get("reset:" + email);
        if (!raw) return json({ error: "הקוד פג תוקף או לא קיים — יש לבקש קוד חדש" }, 400);
        const { code: savedCode, users } = JSON.parse(raw);
        if (code !== savedCode) return json({ error: "קוד שגוי" }, 401);
        const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const hash = await hashPass(newPass, salt);
        for (const user of users) {
          const rec = await env.CACHE.get("user:" + user);
          if (rec) {
            const parsed = JSON.parse(rec);
            await env.CACHE.put("user:" + user, JSON.stringify({ ...parsed, salt, hash }));
          }
        }
        await env.CACHE.delete("reset:" + email);
        return json({ ok: true });
      }

      /* ─── POST /data/save ─── */
      if (url.pathname === "/data/save") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        await env.CACHE.put("data:" + user, JSON.stringify(body.data || {}));
        return json({ ok: true });
      }

      /* ─── POST /data/load ─── */
      if (url.pathname === "/data/load") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        const d = await env.CACHE.get("data:" + user);
        return json(d ? JSON.parse(d) : {});
      }

      return json({ error: "unknown route" }, 404);
    } catch (e) {
      return json({ error: e.message || "server error" }, 500);
    }
  },
};
