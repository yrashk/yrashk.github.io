#!/usr/bin/env node
// Keeps .strava-private.json (the zone seed, private zones, excluded activities) in git without
// exposing it: sealed with a password into strava-private.sealed.json, which is committed.
//
//   npm run strava:seal      .strava-private.json → strava-private.sealed.json (asks for a password twice)
//   npm run strava:unseal    strava-private.sealed.json → .strava-private.json (asks for the password)
//
// AES-256-GCM with a key from scrypt (N = 2^17, r = 8, p = 1) and a random salt and IV per seal.
// The sealed file is public: it is only as strong as the password, so use a long one. The password
// is read from the terminal with echo off and never stored. Dependency-free; Node 20+.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PLAIN = ".strava-private.json";
const SEALED = "strava-private.sealed.json";
const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const mode = process.argv[2];

function ask(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("run this in a terminal: the password is typed, not piped"));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let pw = "";
    const done = (err) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); err ? reject(err) : resolve(pw); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("cancelled"));
        if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
        else pw += ch;
      }
    };
    stdin.on("data", onData);
  });
}
const key = (pw, salt) => scryptSync(pw.normalize("NFC"), salt, 32, KDF);

try {
  if (mode === "seal") {
    if (!existsSync(PLAIN)) throw new Error(`${PLAIN} not found: run an import first (npm run strava) or unseal`);
    const plain = readFileSync(PLAIN);
    JSON.parse(plain); // refuse to seal something that is not the private file
    const pw = await ask("password: ");
    if (pw.length < 12) throw new Error("use at least 12 characters: the sealed file is public");
    if ((await ask("again: ")) !== pw) throw new Error("the passwords differ");
    const salt = randomBytes(16), iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key(pw, salt), iv);
    const data = Buffer.concat([c.update(plain), c.final()]);
    const out = { v: 1, cipher: "aes-256-gcm", kdf: "scrypt", N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
    writeFileSync(SEALED, JSON.stringify(out, null, 2) + "\n");
    console.log(`sealed ${PLAIN} → ${SEALED} (commit it; ${PLAIN} stays out of git)`);
  } else if (mode === "unseal") {
    if (!existsSync(SEALED)) throw new Error(`${SEALED} not found`);
    const s = JSON.parse(readFileSync(SEALED, "utf8"));
    if (s.v !== 1 || s.cipher !== "aes-256-gcm" || s.kdf !== "scrypt") throw new Error(`${SEALED}: unknown format`);
    const pw = await ask("password: ");
    const d = createDecipheriv("aes-256-gcm", scryptSync(pw.normalize("NFC"), Buffer.from(s.salt, "base64"), 32, { N: s.N, r: s.r, p: s.p, maxmem: KDF.maxmem }), Buffer.from(s.iv, "base64"));
    d.setAuthTag(Buffer.from(s.tag, "base64"));
    let plain;
    try { plain = Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]); } catch { throw new Error("wrong password (or the file was changed)"); }
    if (existsSync(PLAIN) && !readFileSync(PLAIN).equals(plain)) throw new Error(`${PLAIN} exists and differs; move it away first`);
    writeFileSync(PLAIN, plain, { mode: 0o600 });
    console.log(`unsealed ${SEALED} → ${PLAIN}`);
  } else {
    console.error("usage: node scripts/strava-seal.mjs seal|unseal");
    process.exit(2);
  }
} catch (e) {
  console.error(`strava-seal: ${e.message}`);
  process.exit(1);
}
