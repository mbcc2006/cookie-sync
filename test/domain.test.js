import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DOMAIN_PATTERN, isDomain } from "../src/domain.js";

function extensionDomains() {
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(new URL("../extension/domains.js", import.meta.url), "utf8"), sandbox);
  return sandbox.self.CookieSyncDomains;
}

test("the extension accepts exactly the domains the relay and CLI accept", () => {
  const D = extensionDomains();
  assert.equal(D.DOMAIN_PATTERN.source, DOMAIN_PATTERN.source);
  for (const domain of ["example.com", "a.b.example.co.uk", "xn--bcher-kva.example", "localhost", "192.168.1.1", "10.0.0.1", "-bad.com", "under_score.com"]) {
    assert.equal(D.isSyncable(domain), isDomain(domain), domain);
  }
});

test("Sync all sites skips cookie hosts the relay would reject", () => {
  const D = extensionDomains();
  assert.deepEqual(["example.com", "localhost", "192.168.1.1", "github.com"].filter(D.isSyncable), ["example.com", "github.com"]);
});
