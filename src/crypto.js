import crypto from "node:crypto";

export function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKey: publicKey.export({ format: "pem", type: "spki" })
  };
}

export function encryptFor(publicKeyPem, value) {
  const recipient = crypto.createPublicKey(publicKeyPem);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey: recipient });
  const key = crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), "cookie-sync-v1", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return {
    ephemeralPublicKey: publicKey.export({ format: "pem", type: "spki" }),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptFrom(privateKeyPem, envelope) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const sender = importEphemeralPublicKey(envelope.ephemeralPublicKey);
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey: sender });
  const key = crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), "cookie-sync-v1", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function importEphemeralPublicKey(publicKeyPem) {
  const body = publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, "");
  const der = Buffer.from(body, "base64");
  // v0.2-v0.6 browser snapshots used 1.3.110.110 instead of the X25519 OID 1.3.101.110.
  if (der.length === 44 && der.subarray(0, 12).equals(Buffer.from([48, 42, 48, 5, 6, 3, 43, 110, 110, 3, 33, 0]))) {
    der[7] = 101;
  }
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}
