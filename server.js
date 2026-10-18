"use strict";

require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { Pool } = require("pg");

const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const encryptionKeyHex = process.env.FACE_DATA_ENCRYPTION_KEY || "";
const encryptionKey = Buffer.from(encryptionKeyHex, "hex");
const descriptorLength = 128;
const matchThreshold = 0.48;
const app = express();

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
  console.error("FACE_DATA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 random bytes).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "disable"
    ? false
    : { rejectUnauthorized: process.env.DATABASE_SSL !== "require-insecure" },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({
  permissionsPolicy: {
    features: { camera: ["self"], microphone: [], geolocation: [] }
  }
}));
app.use(express.json({ limit: "16kb", strict: true }));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "@vladmandic", "face-api", "dist"), {
  immutable: true,
  maxAge: "1d"
}));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));
app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/app.js", (_request, response) => response.sendFile(path.join(__dirname, "app.js")));
app.get("/style.css", (_request, response) => response.sendFile(path.join(__dirname, "style.css")));

const enrollLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many enrollment attempts. Try again later." }
});
const verifyLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again later." }
});
const deleteLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many deletion attempts. Try again later." }
});

function validateDescriptor(value) {
  return Array.isArray(value)
    && value.length === descriptorLength
    && value.every((number) => Number.isFinite(number) && number >= -2 && number <= 2);
}

function encryptDescriptor(descriptor) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(descriptor), "utf8"),
    cipher.final()
  ]);
  return { encrypted, iv, tag: cipher.getAuthTag() };
}

function decryptDescriptor(record) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, record.iv);
  decipher.setAuthTag(record.auth_tag);
  const plaintext = Buffer.concat([
    decipher.update(record.encrypted_descriptor),
    decipher.final()
  ]).toString("utf8");
  const descriptor = JSON.parse(plaintext);
  if (!validateDescriptor(descriptor)) throw new Error("Stored face template is invalid.");
  return descriptor;
}

function descriptorDistance(left, right) {
  let squaredDistance = 0;
  for (let index = 0; index < descriptorLength; index++) {
    const delta = left[index] - right[index];
    squaredDistance += delta * delta;
  }
  return Math.sqrt(squaredDistance);
}

function hashManagementToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest();
}

function isSameToken(presented, stored) {
  const presentedHash = hashManagementToken(presented);
  return stored.length === presentedHash.length && crypto.timingSafeEqual(stored, presentedHash);
}

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/enroll", enrollLimit, async (request, response, next) => {
  try {
    const displayName = typeof request.body?.displayName === "string"
      ? request.body.displayName.trim()
      : "";
    const { descriptor, consent } = request.body || {};
    if (displayName.length < 1 || displayName.length > 60) {
      return response.status(400).json({ error: "Enter a display name between 1 and 60 characters." });
    }
    if (consent !== true) {
      return response.status(400).json({ error: "Consent is required before saving a face template." });
    }
    if (!validateDescriptor(descriptor)) {
      return response.status(400).json({ error: "The face sample is invalid. Try capturing it again." });
    }

    const { rows: existingProfiles } = await pool.query(
      "SELECT encrypted_descriptor, iv, auth_tag FROM face_profiles LIMIT 10000"
    );
    for (const profile of existingProfiles) {
      if (descriptorDistance(descriptor, decryptDescriptor(profile)) <= matchThreshold) {
        return response.status(409).json({ error: "A similar face profile is already enrolled. Sign in instead." });
      }
    }

    const managementToken = crypto.randomBytes(32).toString("base64url");
    const { encrypted, iv, tag } = encryptDescriptor(descriptor);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO face_profiles
       (id, display_name, encrypted_descriptor, iv, auth_tag, management_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, displayName, encrypted, iv, tag, hashManagementToken(managementToken)]
    );
    response.status(201).json({ id, displayName, managementToken });
  } catch (error) {
    next(error);
  }
});

app.post("/api/verify", verifyLimit, async (request, response, next) => {
  try {
    const { descriptor } = request.body || {};
    if (!validateDescriptor(descriptor)) {
      return response.status(400).json({ error: "The face sample is invalid. Try again." });
    }

    const { rows } = await pool.query(
      "SELECT id, display_name, encrypted_descriptor, iv, auth_tag FROM face_profiles LIMIT 10000"
    );
    let closest = null;
    let secondClosestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const savedDescriptor = decryptDescriptor(row);
      const distance = descriptorDistance(descriptor, savedDescriptor);
      if (closest === null || distance < closest.distance) {
        if (closest !== null) secondClosestDistance = closest.distance;
        closest = { id: row.id, displayName: row.display_name, distance };
      } else if (distance < secondClosestDistance) {
        secondClosestDistance = distance;
      }
    }

    if (!closest || closest.distance > matchThreshold
      || secondClosestDistance - closest.distance < 0.035) {
      return response.status(401).json({ error: "We couldn’t confidently match that face. Try again in good lighting." });
    }
    response.json({ displayName: closest.displayName });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/profiles/:id", deleteLimit, async (request, response, next) => {
  try {
    const authorization = request.get("authorization") || "";
    const match = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(authorization);
    if (!match) return response.status(401).json({ error: "A valid profile management token is required." });

    const { rows } = await pool.query(
      "SELECT management_token_hash FROM face_profiles WHERE id = $1",
      [request.params.id]
    );
    if (rows.length !== 1 || !isSameToken(match[1], rows[0].management_token_hash)) {
      return response.status(404).json({ error: "Profile not found or deletion token is invalid." });
    }

    await pool.query("DELETE FROM face_profiles WHERE id = $1", [request.params.id]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error("Request failed:", error);
  if (response.headersSent) return;
  response.status(500).json({ error: "The server couldn’t complete that request. Please try again." });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS face_profiles (
      id UUID PRIMARY KEY,
      display_name VARCHAR(60) NOT NULL,
      encrypted_descriptor BYTEA NOT NULL,
      iv BYTEA NOT NULL CHECK (octet_length(iv) = 12),
      auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag) = 16),
      management_token_hash BYTEA NOT NULL CHECK (octet_length(management_token_hash) = 32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS face_profiles_created_at_idx ON face_profiles (created_at)"
  );
  app.listen(port, () => {
    console.log(`FaceKey is listening at http://localhost:${port}`);
  });
}

start().catch(async (error) => {
  console.error("Unable to start FaceKey. Check PostgreSQL and DATABASE_URL.", error);
  await pool.end();
  process.exitCode = 1;
});
