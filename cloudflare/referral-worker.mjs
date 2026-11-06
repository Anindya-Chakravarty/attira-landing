import pages from "../referral-pages.js";

const config = Object.freeze({
  apiBase: "https://api.attira.org",
  webUrl: "https://attira.org",
  androidStoreUrl: "https://play.google.com/store/apps/details?id=com.tricore.attira",
  iosStoreUrl: "https://apps.apple.com/in/app/attira-outfit-planner/id6762454649",
});

function response(body, contentType, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src https://api.attira.org; base-uri 'none'; frame-ancestors 'none'",
      ...extra,
    },
  });
}

export default {
  async fetch(request, env) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return response("Method not allowed", "text/plain; charset=utf-8", 405, { Allow: "GET, HEAD" });
    }
    const url = new URL(request.url);
    let result;
    if (url.pathname === "/.well-known/apple-app-site-association") {
      result = response(JSON.stringify({ applinks: { apps: [], details: [
        { appID: "Q8XGJP48AR.com.outfits.attira", paths: ["/referral/open"] },
      ] } }), "application/json", 200, { "Cache-Control": "public, max-age=300" });
    } else if (url.pathname === "/invite.js") {
      result = await env.ASSETS.fetch(request);
    } else if (url.pathname === "/referral/open") {
      result = response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Attira</title><body><h1>Your invitation is ready</h1><p>Install Attira, then return to your original invitation and tap Open Attira.</p><a href="${config.iosStoreUrl}">Get Attira</a></body></html>`, "text/html; charset=utf-8");
    } else if (/^\/invite\/[^/]+$/.test(url.pathname)) {
      let code = "";
      try { code = decodeURIComponent(url.pathname.slice("/invite/".length)).trim().toUpperCase(); } catch { /* invalid encoding follows the normal fallback */ }
      if (!/^[A-Z0-9_]{3,32}$/.test(code)) {
        result = response(null, "text/plain", 302, { Location: config.webUrl });
      } else {
        const ua = request.headers.get("User-Agent") || "";
        const platform = /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : ua ? "web" : "unknown";
        const fallbackUrl = platform === "android" ? config.androidStoreUrl : platform === "ios" ? config.iosStoreUrl : config.webUrl;
        result = response(pages.renderInvitePage({ creatorCode: code, platform, fallbackUrl, publicCreatorConfig: config, appScheme: "attira" }), "text/html; charset=utf-8");
      }
    } else {
      result = response("Not found", "text/plain; charset=utf-8", 404);
    }
    return request.method === "HEAD" ? new Response(null, result) : result;
  },
};
