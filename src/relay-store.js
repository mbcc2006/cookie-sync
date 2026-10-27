import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Relay storage: records by kind and id, sorted-set indexes and append-only lists, all asynchronous so the same
// relay code runs on the JSON file (self-hosted default) and on Redis (production, COOKIE_SYNC_REDIS_URL).
// update() is the only read-modify-write primitive; it is atomic in both backends, so one-time tokens and access
// grants cannot be used twice by concurrent requests.

const SAVE_DELAY_MS = 1000;
const FORMAT_VERSION = 2;

const clone = (value) => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)));

function createJsonStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "messages.json");
  const records = new Map();
  const indexes = new Map();
  const lists = new Map();
  let timer;
  let dirty = false;

  const kindMap = (kind) => records.get(kind) || records.set(kind, new Map()).get(kind);
  const index = (name) => indexes.get(name) || indexes.set(name, new Map()).get(name);

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    // Tests and operators may remove the data directory before the relay closes; there is nothing left to save to.
    if (!dirty || !fs.existsSync(directory)) return;
    const value = {
      version: FORMAT_VERSION,
      records: Object.fromEntries([...records].map(([kind, map]) => [kind, Object.fromEntries(map)])),
      indexes: Object.fromEntries([...indexes].filter(([, map]) => map.size).map(([name, map]) => [name, Object.fromEntries(map)])),
      lists: Object.fromEntries([...lists].filter(([, list]) => list.length))
    };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    dirty = false;
  }
  // Many writes within a second become one rewrite of the file; close() and process exit flush the rest.
  function changed() {
    dirty = true;
    if (!timer) {
      timer = setTimeout(flush, SAVE_DELAY_MS);
      timer.unref?.();
    }
  }

  const store = {
    backend: "json",
    async get(kind, id) { return clone(kindMap(kind).get(id) ?? null); },
    async getMany(kind, ids) { return ids.map((id) => kindMap(kind).get(id)).filter(Boolean).map(clone); },
    async set(kind, id, value) { kindMap(kind).set(id, clone(value)); changed(); },
    async swap(kind, id, value) {
      const previous = kindMap(kind).get(id) ?? null;
      kindMap(kind).set(id, clone(value));
      changed();
      return clone(previous);
    },
    async delete(kind, id) { if (kindMap(kind).delete(id)) changed(); },
    async update(kind, id, fn) {
      const previous = kindMap(kind).get(id) ?? null;
      const next = fn(clone(previous));
      if (next === undefined) return { changed: false, previous: clone(previous), value: clone(previous) };
      if (next === null) kindMap(kind).delete(id);
      else kindMap(kind).set(id, clone(next));
      changed();
      return { changed: true, previous: clone(previous), value: clone(next) };
    },
    async zAdd(name, member, score = 0) { index(name).set(member, score); changed(); },
    async zRem(name, member) { if (indexes.get(name)?.delete(member)) changed(); },
    async zMembers(name) { return [...(indexes.get(name) || [])].sort((a, b) => a[1] - b[1]).map(([member]) => member); },
    async zRangeByScore(name, max) { return [...(indexes.get(name) || [])].filter(([, score]) => score <= max).map(([member]) => member); },
    async zDelete(name) { if (indexes.delete(name)) changed(); },
    async listAppend(name, value, max) {
      const list = lists.get(name) || lists.set(name, []).get(name);
      list.push(clone(value));
      if (list.length > max) list.splice(0, list.length - max);
      changed();
    },
    async listAll(name) { return clone(lists.get(name) || []); },
    async listReplace(name, values) {
      if (values.length) lists.set(name, clone(values));
      else lists.delete(name);
      changed();
    },
    async listDelete(name) { if (lists.delete(name)) changed(); },
    flush,
    async close() { flush(); }
  };

  let legacy;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.version === FORMAT_VERSION) {
      for (const [kind, map] of Object.entries(value.records || {})) records.set(kind, new Map(Object.entries(map)));
      for (const [name, map] of Object.entries(value.indexes || {})) indexes.set(name, new Map(Object.entries(map)));
      for (const [name, list] of Object.entries(value.lists || {})) lists.set(name, list);
    } else {
      legacy = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // The pre-0.11 file kept plain arrays; convert it in memory and keep the original next to the new file.
  store.ready = legacy
    ? importLegacy(store, legacy).then(() => {
      fs.copyFileSync(file, `${file}.v1.bak`);
      flush();
    })
    : Promise.resolve();
  return store;
}

// Atomic compare-and-set: write ARGV[2] (or delete when empty) only if the key still holds ARGV[1] ("" = absent).
const CAS_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if (current == false and ARGV[1] == "") or current == ARGV[1] then
  if ARGV[2] == "" then redis.call("DEL", KEYS[1]) else redis.call("SET", KEYS[1], ARGV[2]) end
  return 1
end
return 0`;

async function createRedisStore(url, { prefix = "cs:", legacyFile } = {}) {
  const { createClient } = await import("redis");
  // Without the offline queue, requests during a Redis outage fail at once (503) instead of hanging until it returns.
  const client = createClient({ url, disableOfflineQueue: true });
  let lastError = "";
  client.on("error", (error) => {
    if (error.message !== lastError) console.error("CookieSync relay Redis error:", error.message);
    lastError = error.message;
  });
  client.on("ready", () => { lastError = ""; });
  // Fail start-up instead of waiting forever, so the process manager restarts the relay and the outage is visible.
  let timer;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Redis at ${new URL(url).host} did not answer within 10 seconds.`)), 10_000); })
    ]);
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const command = (args) => client.sendCommand(args.map(String));
  const key = (kind, id) => `${prefix}${kind}:${id}`;
  const zKey = (name) => `${prefix}z:${name}`;
  const lKey = (name) => `${prefix}l:${name}`;
  const parse = (text) => (text === null || text === undefined ? null : JSON.parse(text));

  const store = {
    backend: "redis",
    async get(kind, id) { return parse(await command(["GET", key(kind, id)])); },
    async getMany(kind, ids) {
      if (!ids.length) return [];
      return (await command(["MGET", ...ids.map((id) => key(kind, id))])).map(parse).filter(Boolean);
    },
    async set(kind, id, value) { await command(["SET", key(kind, id), JSON.stringify(value)]); },
    // GETSET rather than SET ... GET, which needs Redis 6.2.
    async swap(kind, id, value) { return parse(await command(["GETSET", key(kind, id), JSON.stringify(value)])); },
    async delete(kind, id) { await command(["DEL", key(kind, id)]); },
    async update(kind, id, fn) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const text = await command(["GET", key(kind, id)]);
        const previous = parse(text);
        const next = fn(clone(previous));
        if (next === undefined) return { changed: false, previous, value: previous };
        const written = await command(["EVAL", CAS_SCRIPT, 1, key(kind, id), text ?? "", next === null ? "" : JSON.stringify(next)]);
        if (Number(written) === 1) return { changed: true, previous, value: next };
      }
      throw new Error(`Concurrent updates kept conflicting on ${kind}:${id}.`);
    },
    async zAdd(name, member, score = 0) { await command(["ZADD", zKey(name), score, member]); },
    async zRem(name, member) { await command(["ZREM", zKey(name), member]); },
    async zMembers(name) { return command(["ZRANGE", zKey(name), 0, -1]); },
    async zRangeByScore(name, max) { return command(["ZRANGEBYSCORE", zKey(name), "-inf", max]); },
    async zDelete(name) { await command(["DEL", zKey(name)]); },
    async listAppend(name, value, max) {
      await client.multi().addCommand(["RPUSH", lKey(name), JSON.stringify(value)]).addCommand(["LTRIM", lKey(name), String(-max), "-1"]).exec();
    },
    async listAll(name) { return (await command(["LRANGE", lKey(name), 0, -1])).map(parse); },
    async listReplace(name, values) {
      const transaction = client.multi().addCommand(["DEL", lKey(name)]);
      if (values.length) transaction.addCommand(["RPUSH", lKey(name), ...values.map((value) => JSON.stringify(value))]);
      await transaction.exec();
    },
    async listDelete(name) { await command(["DEL", lKey(name)]); },
    flush() {},
    async close() { if (client.isOpen) await client.close(); }
  };

  // First start against an empty Redis: import the JSON file this relay used before, once, behind a lock.
  const marker = `${prefix}meta:initialized`;
  store.ready = (async () => {
    if (await command(["EXISTS", marker]) === 1) return;
    if (await command(["SET", `${prefix}meta:importing`, process.pid, "NX", "PX", 120_000]) === null) {
      while (await command(["EXISTS", marker]) !== 1) await new Promise((resolve) => setTimeout(resolve, 200));
      return;
    }
    let imported = 0;
    if (legacyFile && fs.existsSync(legacyFile)) {
      const value = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
      imported = await importLegacy(store, value.version === FORMAT_VERSION ? fromCurrentFormat(value) : value);
      console.log(`CookieSync relay: imported ${imported} records from ${legacyFile} into Redis.`);
    }
    await command(["SET", marker, JSON.stringify({ at: new Date().toISOString(), imported })]);
    await command(["DEL", `${prefix}meta:importing`]);
  })();
  return store;
}

// A version-2 JSON file converted back to the plain arrays importLegacy understands.
function fromCurrentFormat(value) {
  const all = (kind) => Object.values(value.records?.[kind] || {});
  return {
    pairs: all("pair"), devices: all("device"), messages: all("message"), imports: all("import"), accessRequests: all("access"),
    auditEvents: Object.entries(value.lists || {}).filter(([name]) => name.startsWith("audit:")).flatMap(([, list]) => list),
    pushSubscriptions: all("push")
  };
}

export const pushKey = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex");

// Writes pre-0.11 arrays through the store API; also used to move a JSON relay into Redis. Returns the record count.
export async function importLegacy(store, legacy) {
  const now = Date.now();
  let count = 0;
  for (const pair of legacy.pairs || []) {
    await store.set("pair", pair.code, pair);
    await store.zAdd("expiry:pair", pair.code, pair.expiresAt);
    count += 1;
  }
  for (const device of legacy.devices || []) {
    await store.set("device", device.id, device);
    await store.zAdd(`pair-devices:${device.code}`, device.id, device.createdAt || 0);
    count += 1;
  }
  for (const message of (legacy.messages || []).sort((a, b) => a.createdAt - b.createdAt)) {
    if (message.expiresAt <= now) continue;
    await store.set("message", message.id, message);
    const previous = await store.swap("latest", `${message.deviceId}:${message.domain}`, { id: message.id });
    if (previous && previous.id !== message.id) {
      await store.delete("message", previous.id);
      await store.zRem(`device-messages:${message.deviceId}`, previous.id);
      await store.zRem("expiry:message", previous.id);
    }
    await store.zAdd(`device-messages:${message.deviceId}`, message.id, message.createdAt);
    await store.zAdd("expiry:message", message.id, message.expiresAt);
    count += 1;
  }
  for (const item of legacy.imports || []) {
    if (item.expiresAt <= now) continue;
    await store.set("import", item.id, item);
    await store.zAdd(`pair-imports:${item.code}`, item.id, item.createdAt || 0);
    await store.zAdd("expiry:import", item.id, item.expiresAt);
    count += 1;
  }
  for (const item of legacy.accessRequests || []) {
    await store.set("access", item.id, item);
    await store.zAdd(`device-access:${item.deviceId}`, item.id, item.createdAt || 0);
    await store.zAdd("expiry:access", item.id, item.expiresAt);
    count += 1;
  }
  const audits = new Map();
  for (const event of legacy.auditEvents || []) {
    if (!audits.has(event.deviceId)) audits.set(event.deviceId, []);
    audits.get(event.deviceId).push(event);
  }
  for (const [deviceId, events] of audits) {
    await store.listReplace(`audit:${deviceId}`, events.sort((a, b) => a.createdAt - b.createdAt));
    await store.zAdd("audit-devices", deviceId, 0);
    count += events.length;
  }
  for (const item of legacy.pushSubscriptions || []) {
    if (!item.subscription?.endpoint) continue;
    const id = pushKey(item.subscription.endpoint);
    await store.set("push", id, item);
    await store.zAdd(`pair-push:${item.code}`, id, item.createdAt || 0);
    count += 1;
  }
  return count;
}

export async function openRelayStore({ dataDirectory, redisUrl, redisPrefix }) {
  if (!redisUrl) return createJsonStore(dataDirectory);
  return createRedisStore(redisUrl, { prefix: redisPrefix, legacyFile: path.join(dataDirectory, "messages.json") });
}
