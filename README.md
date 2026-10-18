# FaceKey — camera sign-in prototype

FaceKey is an experimental, consent-based camera face-matching demo. It is **not Apple Face ID**, does not use a device passkey, and is **not safe to protect sensitive accounts**. Webcam face embeddings can be spoofed; browser-side matching is not proof of identity.

## Privacy and security

- Enrollment requires an explicit consent checkbox.
- The browser extracts a 128-number face descriptor locally. Camera frames are not uploaded or stored.
- The backend encrypts descriptors at rest with AES-256-GCM and stores them in PostgreSQL. The encryption key is separate from the database and must be kept secret.
- A per-profile deletion token is stored in this browser so the enrolled profile can be deleted. Clearing browser storage loses that token; this demo has no account recovery.
- The browser submits descriptors to the API. A user can modify browser code or replay a captured descriptor, so this is a demonstration—not a secure authentication factor, liveness detector, or production identity system.
- The entered destination is only a browser redirect. FaceKey does not integrate with or create a login session for the destination website.
- Do not enroll another person without their informed consent. Follow applicable biometric privacy and data-protection laws. The operator is responsible for protecting the database, encryption key, backups, and server.
- The face matching library and model weights are served from this application. The model files are from the MIT-licensed `@vladmandic/face-api` distribution.

## Project structure

```text
hand-gesture/
├── app.js
├── index.html
├── server.js
├── style.css
├── package.json
├── .env.example
├── docker-compose.yml
└── public/
    ├── vendor/
    │   ├── face-api.js
    │   └── face-api-LICENSE
    └── models/
        ├── tiny_face_detector_model-weights_manifest.json
        ├── tiny_face_detector_model.bin
        ├── face_landmark_68_model-weights_manifest.json
        ├── face_landmark_68_model.bin
        ├── face_recognition_model-weights_manifest.json
        └── face_recognition_model.bin
```

## Run locally

Requirements: Node.js 20 or newer, npm, and Docker Desktop (or an existing PostgreSQL 16+ server).

1. Copy `.env.example` to `.env`.
2. Generate a private encryption key with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Paste the output into `FACE_DATA_ENCRYPTION_KEY` in `.env`. Keep this key separate from the database and never commit `.env`.
3. Start the local PostgreSQL database:

   ```powershell
   docker compose up -d postgres
   ```

   The example database credentials are for local development only. For an existing PostgreSQL database, set `DATABASE_URL` and its TLS setting in `.env`.
4. Install packages and start FaceKey:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:3000`. Allow camera access when prompted. Use **Create profile** to enroll a face with consent; afterward, enter the destination and choose **Sign in**.

The server creates its database table on startup. Templates and encrypted deletion-token hashes are stored in PostgreSQL; the profile deletion token is kept in the enrolling browser’s local storage. Deleting the database or losing the encryption key makes stored profiles unusable.

## Deploy to Vercel

Import this repository into Vercel with the project root set to the repository root. Vercel's zero-configuration Express support deploys the exported application from `server.js`; the face library and models under `public/` are served as static assets. Do not set a static output directory or a custom build command.

Add these environment variables to the Vercel project for **Production** (and Preview if you plan to test preview deployments):

- `DATABASE_URL`: a PostgreSQL connection string from a hosted provider. Prefer its pooled connection string for serverless functions.
- `FACE_DATA_ENCRYPTION_KEY`: a unique key generated with the command above. Keep it in Vercel’s secret environment-variable storage and backed up separately from the database.
- `NODE_ENV=production`

Redeploy after setting the variables. Without them, the static page will load but `/api/*` deliberately returns HTTP 503 with the missing configuration named. A destination redirect only navigates the browser; it does not create an authenticated session on the destination website.

## Production

Do not deploy this demo as authentication for real accounts or high-value websites. Use WebAuthn/passkeys instead: platform Face ID verifies locally and the website stores only a public key, never face data. A real biometric product additionally needs professionally validated liveness detection, threat modeling, secure server-side inference, access controls, retention/deletion policies, monitoring, backups, and legal review. Use HTTPS, a managed PostgreSQL service with verified TLS, a secrets manager for the encryption key, strict origin controls, and reviewed retention/deletion procedures before any broader test.
