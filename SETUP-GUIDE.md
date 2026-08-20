# Daly Recovery — Complete Setup & Installation Guide

This guide walks you through everything: creating your backend, connecting payments, deploying the app, and signing in as the Executive Manager.

---

## What You're Setting Up

- **Resident PWA** (`index.html`) — the app your residents use on their phones to check in/out, chat, pay rent, log meetings, etc.
- **Manager Dashboard** (`dashboard.html`) — the web dashboard you use to manage residents, review applications, track rent, log incidents/tests, and configure house settings.
- **Firebase Backend** — handles authentication (phone/SMS), the database (Firestore), and scheduled tasks (Cloud Functions).
- **Stripe Payments** — collects rent payments by card through secure checkout.

---

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**
3. Name it something like `daly-recovery` (or whatever you want)
4. You can disable Google Analytics (not needed) — click **Create project**
5. Wait for it to create, then click **Continue**

### Add a Web App

1. On the project overview page, click the **web icon** (`</>`) to add a web app
2. Give it a nickname like `Daly Recovery App`
3. You do NOT need Firebase Hosting (you're using Cloudflare Pages) — leave it unchecked
4. Click **Register app**
5. You'll see a code block with your `firebaseConfig` — **copy these values**, you'll need them in Step 4

It looks like this:
```js
const firebaseConfig = {
  apiKey: "AIzaSyD...",
  authDomain: "daly-recovery.firebaseapp.com",
  projectId: "daly-recovery",
  storageBucket: "daly-recovery.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Keep this tab open — you'll paste these into your config file shortly.

---

## Step 2: Enable Phone Authentication

1. In the Firebase Console, go to **Build → Authentication**
2. Click **Get started**
3. Go to the **Sign-in method** tab
4. Click **Phone** and toggle it **ON**
5. Click **Save**

### Add Your Manager Phone Number for Testing (Optional but Recommended)

While you're testing, you can add your phone number as a test number so you don't burn through SMS credits:

1. Still on the **Sign-in method** tab, scroll down to **Phone numbers for testing**
2. Add your phone number (e.g., `+14061234567`) and a test code (e.g., `123456`)
3. Click **Save**

> When you sign in with this test number, use the code you set — no real SMS is sent.

---

## Step 3: Set Up Firestore Database

1. In Firebase Console, go to **Build → Firestore Database**
2. Click **Create database**
3. Choose a location closest to your residents (e.g., `us-central` for Montana)
4. Start in **Production mode** (your security rules will protect the data)
5. Click **Create**

### Deploy Security Rules

You need the Firebase CLI for this. On your computer:

```bash
# Install Firebase CLI (if you don't have it)
npm install -g firebase-tools

# Log in to your Firebase account
firebase login

# Navigate to your project folder
cd daly-recovery-app

# Initialize Firebase in this folder
firebase init
```

When `firebase init` asks what to set up, select:
- **Firestore** (use arrow keys and spacebar to select)
- **Functions** (select this too)

It will ask:
- **Use an existing project?** → Yes, select your `daly-recovery` project
- **Firestore Rules file?** → Press Enter to accept `firestore.rules` (already exists)
- **Firestore Indexes file?** → Press Enter for default
- **Functions language?** → Choose **JavaScript**
- **Use ESLint?** → No (keeps it simple)
- **Install dependencies?** → Yes

Then deploy the rules:

```bash
firebase deploy --only firestore:rules
```

### Create the Manager Document (IMPORTANT — This Makes You the Manager)

Before you can sign in as the manager, you need to create your user document in Firestore. You have two options:

#### Option A: Through the Firebase Console (Easiest)

1. Go to **Firestore Database** in the Firebase Console
2. Click **Start collection**
3. Collection ID: `users`
4. Click **Next**
5. For the Document ID, you'll need your Firebase Auth UID — you'll get this after your first sign-in attempt. **Skip to Step 7 first**, sign in once, then come back here. OR use Option B.

#### Option B: Through the Firebase Console After First Sign-In

1. First, go to **Step 7** and sign into the dashboard with your phone number
2. The sign-in will succeed (phone auth works) but you'll see a blank dashboard because no user document exists yet
3. Go to **Firebase Console → Authentication → Users** tab
4. Find your phone number — copy the **User UID** (a long string like `aBcDeFg123...`)
5. Go to **Firestore Database → users** collection (create it if it doesn't exist)
6. Click **Add document**
7. Set the **Document ID** to your User UID (paste it)
8. Add these fields:

| Field | Type | Value |
|-------|------|-------|
| `name` | string | `Your Name` (e.g., "Sam Yarbro") |
| `role` | string | `manager` |
| `phone` | string | `+14061234567` (your phone number with country code) |
| `active` | boolean | `true` |

9. Click **Save**
10. Now refresh the dashboard — you're the Executive Manager!

### Create House Settings

While you're in Firestore, create the house configuration:

1. Click **Start collection** (or **Add document** if `house` exists)
2. Collection ID: `house`
3. Document ID: `settings`
4. Add these fields:

| Field | Type | Value |
|-------|------|-------|
| `name` | string | `Daly Recovery` |
| `curfew` | string | `10:00 PM` |
| `curfewEnd` | string | `6:00 AM` |
| `weeklyRent` | number | `185` |
| `meetingsRequired` | number | `3` |
| `testCadence` | string | `Weekly` |
| `totalBeds` | number | `12` (or however many beds you have) |
| `managerPhone` | string | `+14061234567` |
| `appUrl` | string | `https://your-app-domain.pages.dev` |

5. Click **Save**

> You can change all of these later from the **House Settings** section of the dashboard.

---

## Step 4: Add Your Firebase Config to the App

Open the file `js/firebase-config.js` and replace the placeholder values with your real Firebase config:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD...",           // ← paste your real API key
  authDomain: "daly-recovery.firebaseapp.com",
  projectId: "daly-recovery",
  storageBucket: "daly-recovery.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Also update the Stripe values (you'll get these in Step 5):

```js
const STRIPE_PUBLISHABLE_KEY = "pk_live_...";   // from Stripe Dashboard
const STRIPE_CHECKOUT_URL = "https://us-central1-daly-recovery.cloudfunctions.net/createCheckoutSession";
```

---

## Step 5: Set Up Stripe for Rent Payments

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/) and create an account (or sign in)
2. Complete identity verification so you can accept real payments

### Get Your API Keys

1. Go to **Developers → API keys**
2. Copy your **Publishable key** (`pk_live_...`) — paste this into `firebase-config.js` as `STRIPE_PUBLISHABLE_KEY`
3. Copy your **Secret key** (`sk_live_...`) — you'll need this for Cloud Functions (Step 6)

> **Tip:** While testing, use the **Test mode** keys (`pk_test_...` / `sk_test_...`). Toggle "Test mode" in the Stripe Dashboard. Switch to live keys when you're ready to accept real payments.

---

## Step 6: Deploy Cloud Functions

Cloud Functions handle Stripe payment processing and weekly automated tasks (rent charges, meeting resets).

### Set Stripe Keys as Firebase Config

```bash
# Set your Stripe secret key
firebase functions:config:set stripe.secret_key="sk_live_YOUR_SECRET_KEY"

# Set your Stripe webhook secret (you'll get this in the next step)
firebase functions:config:set stripe.webhook_secret="whsec_YOUR_WEBHOOK_SECRET"
```

### Deploy the Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

After deployment, Firebase will show you the function URLs. They look like:
```
✔ functions[createCheckoutSession]: https://us-central1-daly-recovery.cloudfunctions.net/createCheckoutSession
✔ functions[stripeWebhook]: https://us-central1-daly-recovery.cloudfunctions.net/stripeWebhook
```

**Copy the `createCheckoutSession` URL** and paste it into `js/firebase-config.js` as `STRIPE_CHECKOUT_URL`.

### Set Up the Stripe Webhook

1. Go to **Stripe Dashboard → Developers → Webhooks**
2. Click **Add endpoint**
3. Paste your `stripeWebhook` function URL: `https://us-central1-daly-recovery.cloudfunctions.net/stripeWebhook`
4. Under **Events to send**, select: `checkout.session.completed`
5. Click **Add endpoint**
6. On the webhook detail page, click **Reveal** under Signing secret
7. Copy the `whsec_...` value
8. Run: `firebase functions:config:set stripe.webhook_secret="whsec_YOUR_VALUE"`
9. Redeploy: `firebase deploy --only functions`

---

## Step 7: Deploy to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) and sign in (or create an account — free tier works)
2. Go to **Workers & Pages → Create**
3. Choose **Pages** → **Connect to Git**
4. Connect your GitHub account and select the `daly-recovery-app` repository
5. Configure the build:
   - **Production branch:** `main`
   - **Build command:** (leave empty — this is a static site, no build step)
   - **Build output directory:** `/` (the root of the repo)
6. Click **Save and Deploy**

Your app will be live at `https://daly-recovery-app.pages.dev` (or whatever Cloudflare assigns).

### Set a Custom Domain (Optional)

1. In your Cloudflare Pages project, go to **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain (e.g., `app.dalyrecovery.org`)
4. Follow the DNS instructions

> **Important:** Once you know your final URL, go back to Firestore → `house` → `settings` and update the `appUrl` field. Also update it in `manifest.webmanifest` if you have a `start_url` set.

---

## Step 8: Sign In as Executive Manager on the Dashboard

This is the part you've been waiting for.

### First-Time Manager Sign-In

1. Open your deployed site's dashboard: `https://your-app-domain.pages.dev/dashboard`
2. You'll see the **Manager sign-in** screen
3. Enter your phone number (the same one you used in the Firestore `users` document)
4. Click **Send sign-in code**
5. You'll receive an SMS with a 6-digit code (or use your test code if you set one up in Step 2)
6. Enter the code and click **Verify**
7. If you already created your manager document in Firestore (Step 3), you'll land on the dashboard with full access
8. If you haven't created the document yet, go back to **Step 3, Option B** and create it now, then refresh

### What You Can Do as Manager

Once signed in, you have access to everything:

- **Board** — see who's home/away/late, open beds, quick-action buttons (send notices, log incidents, record tests), pending flags (new applications, overdue rent), live activity feed
- **Applications** — review intake applications, accept residents (auto-creates their profile, assigns a bed, sends a welcome message), waitlist, or decline
- **Messages** — DM individual residents or send house-wide announcements
- **Rent Ledger** — see who's paid and who's behind, record cash/check/Venmo payments, confirm pending Stripe payments
- **Records** — incident reports, drug test history, alumni list
- **Manage Residents** — add residents manually, edit their info (chore, bed, sponsor, balance), discharge residents
- **House Settings** — change house name, curfew times, weekly rent amount, meeting requirements, test cadence, manager phone number

### Adding Your First Resident

1. Go to **Manage Residents** in the dashboard sidebar
2. Click **Add resident**
3. Enter their name, phone number, and assign a bed
4. Click **Save**
5. Tell the resident to open the app URL on their phone and sign in with their phone number
6. They'll be able to check in/out, chat with you, see their rent balance, log meetings, and everything else

Alternatively, residents can apply through the app:
1. They open the app URL
2. On the sign-in screen, they tap **Apply to join**
3. They fill out the 3-step application form
4. You'll see the application appear in your **Applications** tab
5. Click **Accept** to create their profile and assign a bed

---

## Troubleshooting

### "Access denied" or blank dashboard after sign-in
Your Firestore `users` document either doesn't exist or the `role` field isn't set to `manager`. See Step 3.

### SMS codes not arriving
- Make sure Phone Authentication is enabled in Firebase Console
- Check that you've set up billing (Firebase requires Blaze plan for phone auth in production — the free tier allows a limited number of SMS per day)
- Use test phone numbers during development to avoid this issue

### Stripe payments not working
- Make sure `STRIPE_CHECKOUT_URL` in `firebase-config.js` points to your deployed Cloud Function
- Make sure the Stripe webhook is set up and pointing to your `stripeWebhook` function URL
- Check Cloud Function logs: Firebase Console → Functions → Logs

### Rent not auto-charging weekly
- The `weeklyRentCharge` Cloud Function runs every Monday at midnight Mountain Time
- Make sure your Cloud Functions deployed successfully
- Check Firebase Console → Functions to see the scheduled functions listed

### App not loading or showing old version
- Clear the browser cache or open in an incognito window
- The service worker caches aggressively — a hard refresh (Ctrl+Shift+R) forces a reload

---

## File Structure

```
daly-recovery-app/
├── index.html              ← Resident PWA (main app)
├── dashboard.html          ← Manager dashboard
├── manifest.webmanifest    ← PWA manifest
├── sw.js                   ← Service worker (offline support)
├── robots.txt              ← Blocks search engines (private app)
├── _headers                ← Cloudflare Pages headers
├── _redirects              ← Cloudflare Pages redirects
├── firestore.rules         ← Firestore security rules
├── css/
│   └── nocturne.css        ← Design system (dark theme)
├── js/
│   ├── firebase-config.js  ← Firebase + Stripe configuration (EDIT THIS)
│   ├── app.js              ← Resident app logic
│   └── dashboard.js        ← Manager dashboard logic
├── icons/                  ← App icons (add your own)
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-192-maskable.png
│   ├── icon-512-maskable.png
│   └── apple-touch-icon.png
└── functions/              ← Firebase Cloud Functions
    ├── index.js            ← Stripe + scheduled functions
    └── package.json        ← Function dependencies
```

---

## Quick-Start Checklist

- [ ] Create Firebase project
- [ ] Enable Phone Authentication
- [ ] Create Firestore database
- [ ] Deploy security rules (`firebase deploy --only firestore:rules`)
- [ ] Create your manager document in Firestore `users` collection
- [ ] Create `house` → `settings` document
- [ ] Paste your Firebase config into `js/firebase-config.js`
- [ ] Create Stripe account and get API keys
- [ ] Set Stripe keys in Firebase config (`firebase functions:config:set`)
- [ ] Deploy Cloud Functions (`firebase deploy --only functions`)
- [ ] Set up Stripe webhook
- [ ] Paste Stripe publishable key and checkout URL into `js/firebase-config.js`
- [ ] Deploy to Cloudflare Pages (connect GitHub repo)
- [ ] Open `/dashboard`, sign in with your phone, and verify manager access
- [ ] Add your first resident (or have them apply through the app)
- [ ] You're live!
