export function toPlaywrightCookie(cookie) {
  const sameSite = {
    no_restriction: "None",
    lax: "Lax",
    strict: "Strict",
    unspecified: undefined
  }[cookie.sameSite];
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    expires: cookie.expirationDate || -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    ...(sameSite ? { sameSite } : {})
  };
}

export function toPlaywrightStorageState(snapshot) {
  return {
    cookies: snapshot.cookies.map(toPlaywrightCookie),
    origins: []
  };
}
