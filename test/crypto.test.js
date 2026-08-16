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
