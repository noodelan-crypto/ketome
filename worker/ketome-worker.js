/**
 * KetoMe Server — Cloudflare Worker
 * ─────────────────────────────────
 * מסלולים:
 *   POST /image          { image }            → ניתוח מנה מתמונה (AI)
 *   POST /lookup         { query }            → ערכים תזונתיים לפי טקסט (AI + מטמון)
 *   POST /auth/register  { user, pass }       → הרשמה, מחזיר token
 *   POST /auth/login     { user, pass }       → התחברות, מחזיר token
 *   POST /data/save      { token, data }      → שמירת נתוני המשתמש
 *   POST /data/load      { token }            → טעינת נתוני המשתמש
 * סיסמאות נשמרות כ-hash (PBKDF2, 100k איטרציות) — לעולם לא כטקסט.
 *
 * פריסה (בחינם, ~5 דקות):
 * 1. dash.cloudflare.com → Workers & Pages → Create Worker
 * 2. הדבק את הקובץ הזה במקום קוד ברירת המחדל → Deploy
 * 3. Settings → Variables → Add Secret:  ANTHROPIC_API_KEY = המפתח שלך מ-console.anthropic.com
 * 4. (אופציונלי, מטמון) Settings → Bindings → KV Namespace בשם CACHE — חוסך קריאות API על שאילתות חוזרות
 * 5. את כתובת ה-Worker (https://xxx.workers.dev) מדביקים באפליקציה תחת "שרת ניתוח"
 *
 * עלות: האחסון חינם (Workers Free: 100,000 בקשות/יום).
 * קריאות ה-API של Anthropic עולות לפי שימוש — בערך אגורות בודדות לניתוח תמונה.
 */

const MODEL = "claude-sonnet-4-6";
const DAILY_AI_LIMIT = 50;

const IMAGE_PROMPT = `אתה מנתח תזונה לדיאטה קטוגנית. זהה את המנה בתמונה והערך כמויות לפי גודל המנה הנראה.
החזר אך ורק JSON תקין, בלי Markdown ובלי טקסט נוסף:
{"name":"שם המנה בעברית","carbs":גרם פחמימות נטו,"cal":קלוריות,"protein":גרם חלבון,"fat":גרם שומן,"keto":true/false,"note":"משפט קצר בעברית"}
אם אין אוכל בתמונה: {"error":"לא זוהתה מנת אוכל"}`;

const LOOKUP_PROMPT = (q) => `אתה מאגר ערכים תזונתיים המתמחה במזון ישראלי (בסגנון הנתונים של אתר כפית).
עבור המזון והכמות: "${q}"
החזר אך ורק JSON תקין, בלי Markdown:
{"name":"שם + כמות בעברית","carbs":גרם פחמימות נטו לכמות שצוינה,"cal":קלוריות,"protein":חלבון,"fat":שומן,"keto":true/false}
אם הכמות לא צוינה — הנח מנה ממוצעת. אם לא מזוהה מזון: {"error":"לא זוהה"}`;

const LIBRE_PROMPT = `בתמונה צילום מסך מאפליקציית חיישן סוכר רציף (FreeStyle Libre או דומה).
חלץ והחזר אך ורק JSON תקין, בלי Markdown:
{"glucose_now":מספר mg/dL נוכחי,"trend":"עולה"/"יורד"/"יציב","period":"טווח השעות המוצג","pattern":"2-3 משפטים בעברית: מהלך הגרף, עליות/ירידות בולטות והשעות שלהן","in_range":true/false}
אם זו לא תמונת חיישן: {"error":"לא זוהה צילום חיישן"}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

/* ─── עזרי אימות ─── */
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

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

      /* ─── POST /lookup (עם מטמון KV אם מוגדר) ─── */
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
          // שמירה במטמון לחצי שנה — ערכים תזונתיים לא משתנים
          await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 180 });
        }
        return json(result);
      }

      /* ─── POST /libre — ניתוח צילום מסך של חיישן סוכר רציף ─── */
      if (url.pathname === "/libre") {
        if (!body.image) return json({ error: "missing image (base64)" }, 400);
        const result = await callClaude(env, [
          { type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image } },
          { type: "text", text: LIBRE_PROMPT },
        ]);
        /* תיעוד לפי משתמש (אם מחובר ו-KV מוגדר) — בסיס לניתוח מגמות עתידי */
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

      /* ─── POST /auth/register — הרשמה: שם משתמש + סיסמה ─── */
      if (url.pathname === "/auth/register") {
        if (!env.CACHE) return json({ error: "יש להגדיר KV Namespace בשם CACHE" }, 500);
        const user = (body.user || "").trim().toLowerCase();
        const pass = body.pass || "";
        if (user.length < 2 || pass.length < 4) return json({ error: "שם משתמש (2+) וסיסמה (4+ תווים) נדרשים" }, 400);
        if (await env.CACHE.get("user:" + user)) return json({ error: "שם המשתמש כבר תפוס" }, 409);
        const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await hashPass(pass, salt);
        await env.CACHE.put("user:" + user, JSON.stringify({ salt, hash, created: Date.now() }));
        const token = crypto.randomUUID();
        await env.CACHE.put("token:" + token, user, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, token, user });
      }

      /* ─── POST /auth/login — התחברות ─── */
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

      /* ─── POST /data/save — שמירת נתוני המשתמש (עם token) ─── */
      if (url.pathname === "/data/save") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        await env.CACHE.put("data:" + user, JSON.stringify(body.data || {}));
        return json({ ok: true });
      }

      /* ─── POST /data/load — טעינת נתוני המשתמש ─── */
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
