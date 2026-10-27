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
   dev domain (and `localhost` if it is not there). ✅ `dev.plugent.app` added 2026-10-26.
2. API key restrictions: open https://console.cloud.google.com/apis/credentials?project=sebtember-app-dev →
   **API keys** → "Browser key (auto created by Firebase)" → **Application restrictions**. "None" → nothing to do;
   "Websites" → add the Plugent domain and Save.
3. ✅ 2026-10-26: Vaidas created a web app **Plugent Web (dev)** in Sebtember Dev (like PeakPick Web). Its config
   (Project settings → Your apps → Plugent Web (dev) → Config) fills `NEXT_PUBLIC_SEBTEMBER_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}`.

## 4. Sebtember lets Plugent read and charge the wallet (✅ dev, 2026-10-26)
In the **sebtember-web** Vercel project, **Preview** environment:
- `PRODUCT_API_CALLERS`: append `,plugent=plugent-web@plugent-dev.iam.gserviceaccount.com`
  (keep the existing `peakpick=…` entry).
- `PRODUCT_API_AUDIENCE`: already set for PeakPick; note its value for step 5.
- Redeploy `dev` (server-only vars bind at deploy time).

On dev, sebtember's sign-in **email allowlist** still applies: a Plugent user not on it gets no wallet.

## 5. Plugent on Vercel (✅ dev, 2026-10-26)
1. Vercel → **Add New → Project** → import `plugent-web`. Framework: Next.js, defaults.
2. Environment variables (Preview), from `.env.example`:
   - `NEXT_PUBLIC_SEBTEMBER_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` — step 3.3
   - `PLUGENT_SESSION_SECRET` — 32+ random characters (`openssl rand -base64 48`)
   - `SEBTEMBER_API_ORIGIN` — `https://dev.sebtember.app`
   - `SEBTEMBER_PRODUCT_API_AUDIENCE` — the value from step 4
   - `PLUGENT_SERVICE_ACCOUNT_JSON` — the whole JSON key from step 2.3, as one line. Mark it **Sensitive**.
3. Domains: add the Plugent dev domain to the `dev` branch.

## 6. Check it
1. https://dev.plugent.app/api/health — the live `commit`, and `true` for every setting, `sessionSecretLongEnough`
   and `serviceAccountJsonParses`. Never a value.
2. https://dev.plugent.app → **Sign in with your Sebtember account** → your email and your Sebtember balance.

⚠️ **A variable reaches only deployments built AFTER it was saved.** Vercel's Redeploy rebuilds the SAME commit, so
health's `commit` does not change; check the deployment's Created time instead, or push a commit.

| page says | meaning |
|---|---|
| `Sign-in failed: auth/unauthorized-domain` | the domain is not in Sebtember Dev → Authentication → Authorized domains |
| `session_secret_misconfigured` | `PLUGENT_SESSION_SECRET` missing or under 32 characters |
| `not_configured` | `SEBTEMBER_API_ORIGIN`, `SEBTEMBER_PRODUCT_API_AUDIENCE` or `PLUGENT_SERVICE_ACCOUNT_JSON` missing |
| `unauthorized` | sebtember refused the service account: `PRODUCT_API_CALLERS` / audience, or sebtember `dev` not redeployed |
| `no_such_user` | no Sebtember wallet for this login (on dev: the email allowlist) |
