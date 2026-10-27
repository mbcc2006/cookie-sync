// The domain names snapshots are keyed by. extension/domains.js keeps a copy (the extension cannot import from src/);
// test/domain.test.js checks that both patterns stay the same.
export const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isDomain(value) {
  return typeof value === "string" && DOMAIN_PATTERN.test(value);
}
