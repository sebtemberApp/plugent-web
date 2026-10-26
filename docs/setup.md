# Plugent setup (milestone 1: sign in with Sebtember, see your balance)

Do the **dev** column first. Production is the same steps with the prod names, later.

| | dev | prod |
|---|---|---|
| Plugent Google Cloud / Firebase project | `plugent-dev` | `plugent-prod` (not created yet) |
| Sebtember Firebase project (login) | `sebtember-app-dev` | `sebtember-app` |
| Sebtember origin | `https://dev.sebtember.app` | `https://sebtember.app` |
| Plugent Vercel environment | Preview (branch `dev`) | Production (branch `main`) |

## 1. GitHub ✅ done 2026-10-26
Create an **empty private** repo `sebtemberApp/plugent-web` (no README, no licence, no .gitignore). Claude pushes the starter into it.

## 2. Plugent's Google Cloud project (Firebase `plugent-dev` ✅ created 2026-10-26)
1. https://console.firebase.google.com → **Add project** → `plugent-dev`. Google Analytics is not needed.
   (Firestore and Storage are not needed for milestone 1; they come with the first agent.)
2. https://console.cloud.google.com/iam-admin/serviceaccounts?project=plugent-dev → **Create service account**
   `plugent-web`. **No roles** are needed: it only proves who it is to sebtember.app.
3. On that account → **Keys → Add key → JSON**. Keep the file private; it goes into Vercel only (step 5).
   Its email is `plugent-web@plugent-dev.iam.gserviceaccount.com`.

## 3. Sebtember's Firebase Auth (so Plugent can sign people in)
1. Firebase console → `sebtember-app-dev` → **Authentication → Settings → Authorized domains** → add the Plugent
   dev domain (and `localhost` if it is not there).
2. If the sebtember web API key has **HTTP referrer restrictions** (Google Cloud → APIs & Services → Credentials on
   `sebtember-app-dev`), add the Plugent domain there too.
3. Copy the web app config (Project settings → Your apps → Web app): `apiKey`, `authDomain`, `projectId`, `appId`.

## 4. Sebtember lets Plugent read and charge the wallet
In the **sebtember-web** Vercel project, **Preview** environment:
- `PRODUCT_API_CALLERS`: append `,plugent=plugent-web@plugent-dev.iam.gserviceaccount.com`
  (keep the existing `peakpick=…` entry).
- `PRODUCT_API_AUDIENCE`: already set for PeakPick; note its value for step 5.
- Redeploy `dev` (server-only vars bind at deploy time).

On dev, sebtember's sign-in **email allowlist** still applies: a Plugent user not on it gets no wallet.

## 5. Plugent on Vercel
1. Vercel → **Add New → Project** → import `plugent-web`. Framework: Next.js, defaults.
2. Environment variables (Preview), from `.env.example`:
   - `NEXT_PUBLIC_SEBTEMBER_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` — step 3.3
   - `PLUGENT_SESSION_SECRET` — 32+ random characters (`openssl rand -base64 48`)
   - `SEBTEMBER_API_ORIGIN` — `https://dev.sebtember.app`
   - `SEBTEMBER_PRODUCT_API_AUDIENCE` — the value from step 4
   - `PLUGENT_SERVICE_ACCOUNT_JSON` — the whole JSON key from step 2.3, as one line. Mark it **Sensitive**.
3. Domains: add the Plugent dev domain to the `dev` branch.

## 6. Check it
Open the dev domain → **Sign in with your Sebtember account** → you should see your email and your Sebtember
balance. If the balance says `unauthorized`/502, step 4 has not been redeployed or the email does not match;
`not_configured` means a step-5 variable is missing.
