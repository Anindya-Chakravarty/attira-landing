# Attira — SEO / GEO / ASO Audit

**Site:** https://attira.org · **Audited:** 2026-07-18 · **Scope:** all 8 HTML pages, `robots.txt`, `sitemap.xml`, JSON-LD, validated against the live site.

## TL;DR

Attira's on-page SEO is **already mature and well-built**. Only a few real gaps existed; the repo fixes in this pass are done. The **one item that needs your action** is outside the code: Cloudflare is serving a `robots.txt` that **blocks the AI crawlers your repo file welcomes** — fix in the Cloudflare dashboard (§1).

| Area | Status |
|------|--------|
| Titles / descriptions / canonicals (per page, unique) | ✅ Strong |
| Open Graph + Twitter cards (all pages) | ✅ Strong |
| JSON-LD structured data | ✅ Strong (WebSite, Organization, SoftwareApplication, FAQPage, ContactPage, BreadcrumbList, speakable) |
| `lang`, viewport, favicon, apple-touch-icon | ✅ Present on all pages |
| `robots.txt` (repo) + `sitemap.xml` | ✅ Present, valid |
| Analytics (PostHog client + server) | ✅ Present |
| `noindex` on queue/status | ✅ Correct |
| **Live robots.txt blocks AI crawlers (Cloudflare)** | ⚠️ **Action needed (dashboard)** |
| Sitemap `lastmod` stale | ✅ Fixed |
| `privacy-v2.html` indexable duplicate | ✅ Fixed (noindex) |
| PWA manifest / `.ico` | ✅ Manifest added |
| `<meta name="keywords">` | ➖ Absent by design (deprecated — do not add) |
| ASO listing | ➖ App not in stores; draft pack prepared (`ASO-listing-pack.md`) |

---

## 1. ⚠️ ACTION NEEDED — Live robots.txt blocks AI crawlers (Cloudflare override)

**This is the most important finding.** Your repo `robots.txt` explicitly *welcomes* AI/generative
crawlers (GPTBot, ChatGPT-User, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended,
Applebot-Extended, Bingbot) — good for GEO (visibility in ChatGPT, Claude, Perplexity, Gemini,
AI Overviews). **But the file actually served at https://attira.org/robots.txt is different.**
Cloudflare is injecting a "Managed Content" block:

```
# BEGIN Cloudflare Managed content
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
...
User-agent: ClaudeBot
Disallow: /
User-agent: GPTBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: Applebot-Extended
Disallow: /
User-agent: Bytespider / CCBot / Amazonbot / meta-externalagent
Disallow: /
# END Cloudflare Managed content
```

So Cloudflare's AI-crawler blocking is doing the **opposite** of your repo's intent — the AI
search engines you want are being told to stay out. **You confirmed you want them allowed (GEO).**

### Fix (Cloudflare dashboard for the attira.org zone — no code change; the repo file is already correct)

1. Log in to Cloudflare → select the **attira.org** zone.
2. Go to the AI crawler control (location varies by plan): **Security → Settings / Bots**, or the
   **"AI Audit" / "AI Crawl Control"** panel.
3. **Turn OFF** "Block AI Scrapers & Crawlers" (a.k.a. Block AI Bots).
4. **Disable "Managed `robots.txt`" / "Content Signals"** injection so the origin file is served verbatim.
5. If you use Cloudflare's WAF/Bot Fight Mode with an AI-bots rule, disable that rule too.

### Re-validate after the change
```bash
curl -s https://attira.org/robots.txt | grep -i "Cloudflare Managed"   # should print nothing
curl -s https://attira.org/robots.txt | grep -i "Content-Signal"        # should print nothing
curl -s https://attira.org/robots.txt | grep -i -A1 "GPTBot"            # should show Allow: /
```
The served file should then match the repo `robots.txt`.

> Trade-off note: blocking `ai-train` while allowing search/reference is a legitimate stance, but
> it's coarse — Cloudflare's block also stops the *search/answer* crawlers (GPTBot powers ChatGPT
> browsing, Applebot-Extended powers Apple Intelligence). For a pre-launch brand chasing GEO
> visibility, allowing them is the right call.

---

## 2. ✅ Fixed in this pass (repo)

- **`sitemap.xml`** — refreshed all `lastmod` from the stale `2026-06-02` to `2026-07-18`. The 5
  indexable URLs are correct; queue/status stay excluded (they're `noindex`).
- **`privacy-v2.html`** — was `index, follow` while canonicalising to `privacy.html`, i.e. an
  indexable near-duplicate. Set to `noindex, nofollow` (it's a work-in-progress draft). **Decision
  for you:** if `privacy-v2.html` is the intended new policy (it adds DPDP / GDPR / US biometric
  language), *promote* it — replace `privacy.html`'s body with it, set its canonical to
  `/privacy.html`, switch robots back to `index, follow`, and delete `privacy-v2.html`. I left it
  as a hidden draft rather than silently overwriting your live legal page.
- **`site.webmanifest`** (new) + `<link rel="manifest">` added to all 8 pages — PWA/mobile polish,
  installable metadata, satisfies the Lighthouse SEO/PWA manifest check.

## 3. ➖ Deliberately NOT changed

- **`<meta name="keywords">`** — intentionally absent and should stay that way. Google and Bing
  ignore it; it offers no ranking value and can leak your target terms to competitors. Keyword
  targeting now lives in titles, headings, body copy, JSON-LD, and (for the app) the ASO keyword
  field — see `ASO-listing-pack.md`.
- **`robots.txt` (repo)** — already correct; the problem is Cloudflare overriding it (§1).
- **Legal page content** — not rewritten; the privacy-v2 promotion is left as your decision.

## 4. What's already strong (keep it)

- Unique `<title>` + meta description on every page.
- Correct canonicals; `queue`/`status` correctly `noindex, nofollow`.
- Full Open Graph + Twitter Card set with a valid 1200×630 `og-image.png` (loads, HTTP 200).
- Rich, valid JSON-LD: `WebSite`, `Organization` (with `sameAs` socials, contactPoint),
  `SoftwareApplication` (Lifestyle, iOS/Android, free), `FAQPage` (real Q&A — eligible for FAQ rich
  results), `ContactPage`, `BreadcrumbList`, and a `speakable` block (voice-assistant friendly).
- `lang="en"`, viewport, theme-color (light/dark), preconnect to font hosts, hero image preload.
- Clean extension-less routing works live (`/queue`, `/status`, `/faq` all 200).
- PostHog analytics (client + server) with UTM capture.

## 5. ASO

The app is **not yet on the App Store or Google Play** (waitlist phase), so there is no live
listing to audit or validate. A complete, submission-ready **listing pack** — app name/subtitle,
keyword field, short/full descriptions, keyword themes, and a screenshot plan mapped to your
`assets/July_alpha/` screens — has been drafted in **`ASO-listing-pack.md`**. Revisit it when you
submit to the stores.

---

## 6. Full verification checklist

```bash
# Sitemap: valid XML, refreshed dates, all URLs 200
curl -s https://attira.org/sitemap.xml | grep lastmod        # after deploy: 2026-07-18
for u in / /faq.html /contact.html /privacy.html /terms.html; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://attira.org$u)"; done

# robots.txt (after Cloudflare change) — see §1
curl -s https://attira.org/robots.txt | grep -i "Cloudflare Managed"   # empty = fixed

# Manifest valid JSON
curl -s https://attira.org/site.webmanifest | python3 -m json.tool

# Duplicate check
curl -s https://attira.org/privacy-v2.html | grep -i noindex           # after deploy

# Structured data (manual): paste each URL into
#   https://search.google.com/test/rich-results  and  https://validator.schema.org
```
- Optional scored regression sweep: run the `audit-website` skill (squirrelscan) against the live URL.
- Post-launch: submit the sitemap in Google Search Console + Bing Webmaster Tools; add store badges
  to `index.html` and the real store URL to the `SoftwareApplication` schema.
