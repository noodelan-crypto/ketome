# KetoMe · v1.2.2

## הרצה — לחיצה כפולה אחת
`start-ketome.bat` עושה הכל לבד: בודק ש-Node מותקן, מתקין תלויות אם חסרות,
פותח דפדפן ומרים את השרת המקומי. אין צורך בפקודות.

## חיבור השרת החינמי (AI + הרשמה + ענן) — ~5 דק'
1. dash.cloudflare.com → Workers & Pages → Create Worker → Deploy
2. Edit code → הדבק את `worker/ketome-worker.js` → Deploy
3. Settings → Variables and Secrets → Secret בשם `ANTHROPIC_API_KEY`
4. Settings → Bindings → KV Namespace, שם המשתנה: `CACHE`
5. את כתובת ה-Worker להדביק ב-`src/App.jsx`:  `const SERVER_URL = "https://xxx.workers.dev";`
6. בדיקה: פרטים ← חשבון אישי ← "🔌 בדיקת חיבור לשרת"

## בניית גרסת Android (Google Play)
תשתית Capacitor כבר מוגדרת (`capacitor.config.json`). כדי לייצר אפליקציית Android:
```bash
npm install
npm run build
npx cap add android
npx cap copy
npx cap open android
```
זה יפתח את הפרויקט ב-Android Studio. שם: המתינו לסנכרון Gradle, ואז **Build → Build App Bundle(s) / APK(s)**. לפרסום בחנות (Google Play Console, תשלום חד-פעמי ~$25): ראו את המדריך המלא ב-runbook הפריסה.

לאחר כל שינוי בקוד: `npm run build && npx cap copy` ואז בנייה מחדש ב-Android Studio.

## ואלידציה
`npm test` · הגרסה מוצגת באודות — ודאו 1.2.2.

Developed and Maintained By Arye Nudelman. © 2026 All rights reserved
