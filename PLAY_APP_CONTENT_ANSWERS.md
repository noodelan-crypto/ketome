# KetoMe — Play Console "App content" answer sheet

Fill these in Play Console → **Test and release → App content** (and the linked Content rating / Data safety forms). These answers are based on how KetoMe actually works (local + Cloudflare Worker backend, user accounts, health tracking, meal text sent to the Anthropic API). Review each before submitting — **you** are the one attesting to them.

---

## 0. Privacy policy
- **URL:** `https://ketome-c477d.web.app/privacy.html`
- ⚠️ This file (`dist/privacy.html`) must be deployed first. Run `firebase deploy` (or `firebase deploy --only hosting`), then open the URL to confirm it loads before pasting it into the console. If you use a custom domain, use that URL instead.

## 1. App access (IMPORTANT — common rejection cause)
KetoMe requires a login for full functionality, so Google's reviewers need a way in.
- Choose **"All or some functionality is restricted"**.
- Add an instruction set with a **demo account**: create a test user in the app (e.g. username `googlereview`, a password you set), and enter those credentials + short steps here. *(Create this account yourself — I can't create accounts on your behalf.)*

## 2. Ads
- **Does your app contain ads?** → **No.**

## 3. Content rating (IARC questionnaire)
- **Category:** Utility, Productivity, Communication, or Health & Fitness (choose **Utility/Reference** — not "Game").
- Violence / Sexual content / Profanity / Nudity → **No** to all.
- **Controlled substances:** Does the app reference/depict illegal drugs? → **No** (medication tracking for personal use is not drug promotion).
- User-generated content shared with others? → **No** (data is private to the user).
- Does the app share user location? → **No.**
- **Expected rating:** Everyone / PEGI 3.

## 4. Target audience & content
- **Target age group:** select **18 and over** (recommended — it handles personal health data; targeting adults avoids the stricter "Families" requirements).
- Do you want the app available to children / in the Designed for Families program? → **No.**
- Appeals to children? → **No.**

## 5. Data safety form
**Does your app collect or share required user data?** → **Yes.**

Data types to declare as **collected**:

| Data type | Collected | Shared* | Processed | Required/Optional | Purpose |
|---|---|---|---|---|---|
| Name / username | Yes | No | Sent to your server | Required | App functionality, Account management |
| Email address | Yes | No | Sent to your server | Optional | Account management (recovery) |
| Health info (glucose, ketones, blood pressure, weight, meds, meals) | Yes | See note | Sent to your server | Required | App functionality |
| App activity / diagnostics (basic) | Yes | No | — | Required | App functionality |

*"Shared" in Google's terms = transferred to a third party. Your Cloudflare backend is your own infrastructure (a processor), so that's **collection, not sharing**. The **meal-description text sent to the Anthropic API** for AI analysis: Anthropic acts as a service provider processing on your behalf, so it is generally **not** "sharing" — but you must still disclose it in the privacy policy (done). If unsure, the conservative choice is to mark Health info as also "shared" and name the AI processing.

Also answer:
- **Is all data encrypted in transit?** → **Yes** (HTTPS).
- **Do you provide a way to request data deletion?** → **Yes** (in-app + email `noodelan@gmail.com`).
- Do you collect data from advertising ID? → **No.**
- Is any data collected required (vs optional)? → Health data & username **Required**, email **Optional**.

## 6. Health apps declaration
If Google shows a **Health apps** section/declaration (likely, since you track glucose/ketones/BP/meds):
- Describe KetoMe as a **personal wellness/lifestyle tracking** app.
- Confirm it is **not** a medical device and does **not** provide diagnosis or treatment.
- The in-app disclaimer (About screen) and privacy policy both state this — point to them.

## 7. Other sections (quick answers)
- **Government app?** → No.
- **Financial features?** → No.
- **News app?** → No.
- **COVID-19 contact tracing/status?** → No.
- **Data collection for children?** → No.

---

### Reminder about the actual release
Completing the above does **not** publish the app. Production access is still locked until you finish the **closed test** (≈20 invited testers, 12+ opted-in for 14 consecutive days) and then apply for production access. That's the next real step.
