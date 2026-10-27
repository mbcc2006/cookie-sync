(function (global) {
  // What the relay shows the CLI about this browser; shared by the popup (pairing) and the background (uploads).
  async function browserMetadata() {
    const data = navigator.userAgentData;
    const details = data?.getHighEntropyValues ? await data.getHighEntropyValues(["architecture", "bitness", "fullVersionList", "platformVersion"]) : {};
    const brands = details.fullVersionList || data?.brands || [];
    return {
      userAgent: navigator.userAgent,
      platform: data?.platform || navigator.platform || "",
      os: [data?.platform || navigator.platform, details.platformVersion].filter(Boolean).join(" "),
      architecture: [details.architecture, details.bitness].filter(Boolean).join(" "),
      browser: brands.map((item) => `${item.brand} ${item.version}`).join(", "),
      language: navigator.language
    };
  }

  global.CookieSyncMetadata = { browserMetadata };
})(typeof self !== "undefined" ? self : this);
