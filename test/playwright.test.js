import assert from "node:assert/strict";
import test from "node:test";
import { toPlaywrightCookie, toPlaywrightStorageState } from "../src/playwright.js";

test("converts Chrome cookies to Playwright storage state", () => {
  const source = {
    cookies: [{
      name: "session",
      value: "secret",
      domain: ".example.com",
      path: "/account",
      expirationDate: 2_000_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "no_restriction"
    }]
  };

  assert.deepEqual(toPlaywrightStorageState(source), {
    cookies: [{
      name: "session",
      value: "secret",
      domain: ".example.com",
      path: "/account",
      expires: 2_000_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "None"
    }],
    origins: []
  });
});

test("uses Playwright defaults for session cookies", () => {
  assert.deepEqual(toPlaywrightCookie({ name: "a", value: "b", domain: "example.com" }), {
    name: "a",
    value: "b",
    domain: "example.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false
  });
});
