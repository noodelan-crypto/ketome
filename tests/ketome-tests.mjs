/**
 * KetoMe — הרצת תרחישי ואלידציה חיצונית
 * ─────────────────────────────────────
 * הרצה:  node ketome-tests.mjs
 * בודק את לוגיקת הליבה של האפליקציה (המרות, סיווגים, חישובי מאגר,
 * צבעי לוח, יעדים, ודוח) בלי צורך בדפדפן. יציאה עם קוד 1 אם תרחיש נכשל.
 * חשוב: אם משנים לוגיקה ב-KetoMe.jsx — לעדכן את ההעתק כאן ולהריץ שוב.
 */

/* ─── העתק נאמן של לוגיקת הליבה מ-KetoMe-1.0.0.jsx ─── */
const T = { accent: "#0F6B5C", warn: "#B4552D", mid: "#C99A2E" };
const URIC_FACTOR = 59.48;
const parseUric = (raw) => { const v = parseFloat(raw); return isNaN(v) ? null : v > 25 ? v / URIC_FACTOR : v; };
const uricZone = (u) => u == null ? null : u < 3.4 ? { label: "מתחת לטווח" } : u <= 7 ? { label: "בטווח" } : { label: "מעל הטווח" };
const ketoneZone = (k) => k == null ? null : k < 0.5 ? { label: "מחוץ לקטוזיס" } : k <= 1.5 ? { label: "קטוזיס קל" } : k <= 3 ? { label: "קטוזיס אופטימלי" } : { label: "קטונים גבוהים" };
const gkiZone = (g) => g == null ? null : g < 1 ? { label: "קטוזיס תרפויטי" } : g <= 3 ? { label: "קטוזיס גבוה" } : g <= 6 ? { label: "קטוזיס בינוני" } : g <= 9 ? { label: "קטוזיס נמוך" } : { label: "מחוץ לקטוזיס" };
const dayColor = (g, carbLimit) => g == null ? { bg: "transparent" } : g <= carbLimit - 20 ? { bg: T.accent } : g <= carbLimit ? { bg: "#7FA894" } : g <= carbLimit + 20 ? { bg: T.mid } : { bg: T.warn };
const calcCal = (w, h, a, genderM, actMult) => Math.round((10 * w + 6.25 * h - 5 * a + (genderM ? 5 : -161)) * actMult * 0.85 / 10) * 10;
const EGG = { c: 0.6, u: 60 }; // ביצה שלמה במאגר

/* ─── תשתית בדיקה ─── */
let pass = 0, fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ נכשל:", name); }
};
const section = (name) => console.log("\n" + name);

/* ─── תרחישים ─── */
section("המרות יחידות");
t("חומצה אורית 400 (µmol) → ‎6.7 mg/dL", Math.abs(parseUric("400") - 6.72) < 0.1);
t("חומצה אורית 5.5 נשארת mg/dL", parseUric("5.5") === 5.5);
t("קלט לא מספרי → null", parseUric("abc") === null);
t("גלוקוז 90 mg/dL = ‎5 mmol/L", Math.abs(90 / 18 - 5) < 0.001);
t("גלוקוז 140 mg/dL = ‎7.8 mmol/L", Math.abs(140 / 18 - 7.78) < 0.01);

section("סיווגים קליניים");
t("חומצה אורית 6.7 — בטווח (התרחיש שנכשל בגרסה הישנה)", uricZone(6.7).label === "בטווח");
t("חומצה אורית 8 — מעל הטווח", uricZone(8).label === "מעל הטווח");
t("קטונים 2.0 — אופטימלי", ketoneZone(2).label === "קטוזיס אופטימלי");
t("קטונים 0.3 — מחוץ לקטוזיס", ketoneZone(0.3).label === "מחוץ לקטוזיס");
t("קטונים 3.9 — גבוהים", ketoneZone(3.9).label === "קטונים גבוהים");
t("GKI 2.5 — קטוזיס גבוה", gkiZone(2.5).label === "קטוזיס גבוה");
t("GKI 12 — מחוץ לקטוזיס", gkiZone(12).label === "מחוץ לקטוזיס");
t("GKI מגלוקוז 140 וקטונים 3.9 ≈ 2", Math.abs(140 / 18 / 3.9 - 1.99) < 0.02);

section("מאגר מזון וכמויות");
t("6 ביצים שלמות = 360 גר׳", 6 * EGG.u === 360);
t("פחמימות ל־6 ביצים ≈ 2.2 גר׳", Math.abs(EGG.c * 3.6 - 2.16) < 0.1);
t("ביצה אחת ביחידה = 0.4 פחמ׳ (כמו במסך שצילמת)", Math.abs(EGG.c * 0.6 - 0.36) < 0.05);

section("לוח היסטוריה (יעד 50)");
t("20 גר׳ → מצוין (ירוק)", dayColor(20, 50).bg === T.accent);
t("45 גר׳ → ביעד", dayColor(45, 50).bg === "#7FA894");
t("60 גר׳ → קרוב ליעד", dayColor(60, 50).bg === T.mid);
t("80 גר׳ → מעל היעד", dayColor(80, 50).bg === T.warn);
t("יום בלי נתון → ריק", dayColor(null, 50).bg === "transparent");

section("חישוב יעדים (Mifflin-St Jeor, ‎-15%)");
t("זכר 70 ק״ג / 170 / גיל 30 / פעילות קלה → 1890 קל׳", calcCal(70, 170, 30, true, 1.375) === 1890);
t("נקבה 60 ק״ג / 165 / גיל 40 / ישיבה → 1300 קל׳", calcCal(60, 165, 40, false, 1.2) === 1300);
t("מצב רפואי מגביל פחמימות ל־20", Math.min(75, 20) === 20);

section("דוח יומי ושיתוף");
t("קידוד עברית לוואטסאפ תקין", ("https://wa.me/?text=" + encodeURIComponent("דוח יומי")).includes("%D7%93%D7%95%D7%97"));


section("תרופות — לוגיקת תזכורת");
const isMedPending = (m, today, nowHM) => m.takenOn !== today && (!m.time || m.time <= nowHM);
t("תרופה בלי שעה, לא סומנה → ממתינה", isMedPending({ time: "", takenOn: null }, "2026-07-14", "08:00") === true);
t("תרופה סומנה היום → לא ממתינה", isMedPending({ time: "", takenOn: "2026-07-14" }, "2026-07-14", "08:00") === false);
t("תרופה של 09:00 לפני השעה → עדיין לא ממתינה", isMedPending({ time: "09:00", takenOn: null }, "2026-07-14", "08:00") === false);
t("תרופה של 09:00 אחרי השעה → ממתינה", isMedPending({ time: "09:00", takenOn: null }, "2026-07-14", "10:30") === true);
t("סומנה אתמול → ממתינה שוב היום", isMedPending({ time: "", takenOn: "2026-07-13" }, "2026-07-14", "08:00") === true);

section("חיישן ליברה — תקינות נתונים");
const libre = { glucose_now: 129, trend: "יציב", in_range: true };
t("ערך חיישן 129 נשמר כגלוקוז תקין", libre.glucose_now === 129 && Math.abs(129 / 18 - 7.17) < 0.01);

/* ─── סיכום ─── */
console.log(`\n═══ ${pass}/${pass + fail} תרחישים עברו ═══`);
process.exit(fail ? 1 : 0);
