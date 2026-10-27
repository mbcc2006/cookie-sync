(function (global) {
  // Chrome grants these only when the user turns on "Sync all sites".
  const ALL_SITES = ["https://*/*", "http://*/*"];
  // Bump when the disclosure in welcome.html changes so users are asked again.
  const CONSENT_VERSION = 1;
  const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

  // Same result as normalizeDomain in src/cli.js (it is the key the CLI pulls), but also accepts a pasted URL.
  function normalizeDomain(input) {
    let value = String(input || "").trim().toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
      try { value = new URL(value).hostname; } catch { return null; }
    }
    value = value.replace(/^\.+/, "").replace(/[/:?#].*$/, "");
    return DOMAIN_PATTERN.test(value) ? value : null;
  }

  // "*.example.com" also matches example.com itself; http covers cookies without the Secure flag.
  function originsFor(domain) {
    return [`https://*.${domain}/*`, `http://*.${domain}/*`];
  }

  // The allowed entry that covers a cookie's domain, so its snapshot is stored under the name the CLI asks for.
  function coveringDomain(cookieDomain, allowed) {
    const domain = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
    return allowed.find((entry) => domain === entry || domain.endsWith(`.${entry}`)) || null;
  }

  // Only names the relay accepts can be synced: no IP addresses, localhost or other single-label hosts.
  function isSyncable(domain) {
    return normalizeDomain(domain) === domain;
  }

  global.CookieSyncDomains = { ALL_SITES, CONSENT_VERSION, DOMAIN_PATTERN, normalizeDomain, isSyncable, originsFor, coveringDomain };
})(typeof self !== "undefined" ? self : this);
