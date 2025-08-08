# Livit Backend

Backend for the Livit app built on Firebase. It provides Cloud Functions for managing users, locations, events, media uploads, ticket reservations, and operational utilities.

## Prerequisites
- Node.js 18.x (match Functions runtime)
- npm 9+ (or Node’s bundled npm)
- Firebase CLI (`npm i -g firebase-tools`) and login: `firebase login`
- Google Cloud SDK (`gcloud`) for Cloud Tasks setup (optional but recommended)
- Access to the Firebase project (`thelivitapp` by default)

## Project layout
- `firebase.json`, `firestore.rules`, `storage.rules`: Firebase config and emulators
- `functions/`: Cloud Functions (TypeScript)
  - `src/`: function sources (events, media upload, tickets, utils)
  - `package.json`: build and emulator scripts for Functions
  - `setup-queues.sh`: helper to create Cloud Tasks queues
- `scripts/`: one-off admin scripts (run with `ts-node` or compile first)

## Installation
1. Clone the repo
2. Install dependencies at the root (for tooling) and in `functions/`:

```bash
# From repository root
npm install

# Install Cloud Functions deps
cd functions
npm install
```

3. Set the Firebase project (if different from default):
```bash
firebase use thelivitapp
# or
firebase use <your-project-id>
```

## Credentials and configuration
### Service account for Admin SDK (local/dev only)
The current code expects a service account JSON file at `functions/thelivitapp-firebase-adminsdk-wy62v-0e5de686ba.json` (see `functions/src/firebase-admin.ts`). For local development:
- In Firebase Console → Project Settings → Service accounts → Generate new private key.
- Save the file to `functions/thelivitapp-firebase-adminsdk-wy62v-0e5de686ba.json` (or update the import path in `functions/src/firebase-admin.ts`).
- This file is ignored by Git.

Production deployments on Cloud Functions can rely on default credentials, but the code currently requires the JSON. If you prefer default credentials, update initialization in `functions/src/firebase-admin.ts` accordingly.

### Environment variables
Set these as environment variables for local emulation (and CI if needed):
- `GMAIL_EMAIL`: Gmail address used to send emails when `USE_GMAIL=true`
- `NAMECHEAP_EMAIL`: Namecheap Private Email address used when `USE_GMAIL=false`
- `USE_GMAIL`: `true` or `false` to select the email provider

Example (macOS/Linux):
```bash
export GMAIL_EMAIL="your@gmail.com"
export NAMECHEAP_EMAIL="noreply@yourdomain.com"
export USE_GMAIL=false
```

### Secrets (Firebase Secret Manager)
Secrets are consumed via `firebase-functions/params` and must be stored in Firebase Secret Manager for deployments:
- `GMAIL_PASSWORD`
- `NAMECHEAP_PASSWORD`

Set/update secrets:
```bash
firebase functions:secrets:set GMAIL_PASSWORD
firebase functions:secrets:set NAMECHEAP_PASSWORD
```

Notes:
- `firebase.json` currently declares `GMAIL_PASSWORD`. If you use `NAMECHEAP_PASSWORD`, add it there too (optional but recommended).
- For local emulators, you can export these as environment variables before starting the emulator if needed:
```bash
export GMAIL_PASSWORD="..."
export NAMECHEAP_PASSWORD="..."
```

## Running locally
From the repository root:
```bash
# Build functions once
npm --prefix functions run build

# Start all emulators (Firestore, Auth, Functions, UI)
firebase emulators:start
```
Alternatively, from `functions/` you can run only the Functions emulator:
```bash
cd functions
npm run serve
```
The emulator ports are configured in `firebase.json`.

## Cloud Tasks queues (tickets subsystem)
If you use the ticket reservation flows, create the required Cloud Tasks queues once per project:
```bash
# Ensure gcloud is authenticated and set to your project and region
gcloud auth login
gcloud config set project <your-project-id>

# Create queues
bash functions/setup-queues.sh
```
You can change the default region inside the script (`LOCATION`).

## Deploying
Ensure you have set the secrets first (see above), then deploy Functions:
```bash
# Build and deploy Cloud Functions
npm --prefix functions run build
firebase deploy --only functions
# Optionally specify --project <id>
```

## Key Functions and modules
- `create-user`, `create-location`: user/location management
- `events/create_event`: event creation logic
- `media_upload/*`: media validation and upload helpers
- `tickets/ticket_reservation`: ticket reservation flows (uses Cloud Tasks)
- `scanner-accounts`: creates/deletes scanner accounts and emails credentials

## Useful scripts (Functions)
From the `functions/` directory:
```bash
npm run build        # Compile TS → lib
npm run build:watch  # Compile on change
npm run serve        # Build, then start Functions emulator only
npm run deploy       # Deploy only Functions
npm run logs         # Tail function logs
```

## Security and best practices
- Do not commit service account keys or secrets. They are ignored by `.gitignore`.
- Store passwords/API keys in Firebase Secret Manager, not in code.
- Avoid logging environment variables in production.

## Troubleshooting
- Missing credentials: ensure the Admin SDK JSON path matches `functions/src/firebase-admin.ts` or update it.
- Secret not found at runtime: verify you set `GMAIL_PASSWORD` / `NAMECHEAP_PASSWORD` in Secret Manager and granted access to the Functions runtime.
- Email sending issues: check `USE_GMAIL` flag and that corresponding email and password are configured.
- Emulator port conflicts: adjust ports in `firebase.json`.

## License
Proprietary – all rights reserved.
