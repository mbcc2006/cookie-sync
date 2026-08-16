import assert from "node:assert/strict";
import test from "node:test";
import { decryptFrom, encryptFor, generateKeyPair } from "../src/crypto.js";

test("encrypts a cookie snapshot for the CLI identity", () => {
  const identity = generateKeyPair();
  const snapshot = {
    domain: "relay.ivjn.us",
    cookies: [{ name: "session", value: "secret", domain: ".relay.ivjn.us", path: "/" }]
  };

  assert.deepEqual(decryptFrom(identity.privateKey, encryptFor(identity.publicKey, snapshot)), snapshot);
});

test("decrypts legacy browser snapshots with the malformed X25519 SPKI OID", () => {
  const identity = generateKeyPair();
  const snapshot = { domain: "relay.ivjn.us", cookies: [{ name: "legacy", value: "value" }] };
  const envelope = encryptFor(identity.publicKey, snapshot);
  const body = envelope.ephemeralPublicKey.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, "");
  const der = Buffer.from(body, "base64");
  der[7] = 110;
  envelope.ephemeralPublicKey = `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----`;
  assert.deepEqual(decryptFrom(identity.privateKey, envelope), snapshot);
});
