# Attira — ASO Listing Pack (pre-submission draft)

> ## ⚠️ SUPERSEDED — 2026-08-15
>
> **Do not submit from this document.** The canonical App Store metadata now lives in
> `outfits/metadata/` (App Store Connect `asc` format, 20 locales), pulled from and pushed
> to App Store Connect with `asc metadata pull` / `asc metadata apply`.
>
> This pack was written on 2026-07-18 during the waitlist phase and disagrees with the live
> listing on the app name, subtitle, keyword field, promotional text and every URL. The
> Google Play copy in §3 is still the only Play draft that exists and remains useful as
> source material — but re-check it against `outfits/metadata/version/1.0/en-US.json`
> before using any of it.
>
> Superseding audit: `~/.claude/plans/check-aso-for-our-peppy-puppy.md`.

> Prepared 2026-07-18. Attira is not yet on the App Store or Google Play (waitlist phase),
> so there is no live listing to validate — this is a ready-to-use draft for submission.
> Source material: `index.html` (taglines, `SoftwareApplication` schema, feature copy),
> `faq.html` (positioning, pricing, devices), `assets/July_alpha/` (in-app screenshots).
>
> Character counts must be re-checked in App Store Connect / Play Console before you submit —
> the limits below are the platform maximums.

---

## 1. Positioning (one-liner)

Attira is an **AI personal stylist** that turns the clothes you already own into a catalogue
of outfit possibilities — so you stop feeling like you have "nothing to wear" despite a full
wardrobe. Differentiator: *"Pinterest shows you clothes you don't own. Other apps push you to
shop. Attira only ever works with what's already in your wardrobe."*

- **Category:** Lifestyle (primary — matches schema `LifestyleApplication`). Shopping (secondary).
- **Price:** Free core app; premium tier planned later.
- **Platforms:** iOS + Android.

---

## 2. App Store (Apple) — text fields

**App name (≤30 chars)** — pick one:
- `Attira: AI Outfit Stylist` (25)
- `Attira — Wardrobe Stylist` (25)
- `Attira: AI Personal Stylist` (27)

**Subtitle (≤30 chars)** — pick one:
- `Outfits from your own closet` (28)
- `Style the clothes you own` (25)
- `Your AI wardrobe stylist` (24)

**Keyword field (≤100 chars, comma-separated, no spaces after commas, no repeats of name/category).**
Draft (99 chars — verify in App Store Connect):
```
outfit,stylist,wardrobe,closet,what to wear,ootd,fashion,capsule,style,virtual closet,outfit ideas
```
Notes: don't repeat "Attira", "AI", or "Lifestyle" (title/category already rank for them).
Use singular forms — Apple auto-handles plurals. Avoid spaces to save characters.

**Promotional text (≤170 chars, updatable anytime without review):**
```
Join the waitlist for early access. Attira reads your real wardrobe and builds outfits from what you already own — no shopping required.
```

---

## 3. Google Play — text fields

**Title (≤30 chars):** `Attira: AI Outfit Stylist`

**Short description (≤80 chars):**
```
Your AI stylist. Rediscover outfits from the clothes you already own.
```
(68 chars)

**Full description (≤4000 chars):**
```
You have the clothes. Attira has the outfits.

Ever stood in front of a full wardrobe and felt like you have nothing to wear? Attira is an
AI personal stylist that turns the clothes you already own into a catalogue of outfit
possibilities — so getting dressed feels effortless again.

No endless shopping. No inspiration you can't actually wear. Attira works only with what's
already in your closet.

WHAT YOU CAN DO

• Discover — outfit ideas curated from your own wardrobe, trends, moods, and occasions,
  personalised to your style.
• Wardrobe — your entire closet, digitised and organised. Every piece you own, a tap away.
• Aira — chat with your personal AI stylist for looks that fit your day, your mood, and the
  occasion.
• Saved — keep your favourite outfits in one place and build looks you'll actually wear.
• Profile — your Style DNA and wardrobe insights, tuned to how you really dress.

DRESS FOR ANY OCCASION
Work, dinner, weekend, or travel — Attira styles you from what you have.

BUILT AROUND YOUR STYLE
The more you use Attira, the sharper it gets. As you add clothes and save outfits, it learns
your colours, silhouettes, and fits to build your Style DNA — a picture of what works for you
specifically.

START SMALL
You don't have to photograph everything. Add 10–15 pieces and Attira already gives you smart
suggestions. Build your wardrobe at your own pace.

FREE TO USE
The core experience — wardrobe organiser, daily outfit suggestions, and Aira your AI stylist —
is free.

Attira: rediscover outfits from pieces you already own.
```

---

## 4. Keyword themes (for ASO + web copy + content)

Prioritised by relevance × intent (high → medium):

| Priority | Keyword theme |
|----------|---------------|
| High | AI personal stylist, AI stylist app, outfit generator, what to wear |
| High | digital wardrobe, virtual closet, wardrobe organizer, closet organizer |
| Medium | outfit ideas, outfit planner, capsule wardrobe, mix and match clothes |
| Medium | daily outfit, style assistant, fashion AI, Style DNA |
| Long-tail | outfits from clothes I own, what to wear today, style my wardrobe |

These belong in the store keyword field, screenshot captions, and the site's headings/body
copy — not in a `<meta name="keywords">` tag (deprecated and ignored by search engines).

---

## 5. Screenshot plan

Source assets already exist in `assets/July_alpha/` (738×1600, light + dark for each screen).
Map them to captioned store frames (App Store requires 6.7"/6.9" portrait; Play requires ≥2,
recommend 5–8):

| # | Screen (asset) | Caption |
|---|----------------|---------|
| 1 | `Explore_light.jpeg` | "Outfit ideas, curated from your own wardrobe" |
| 2 | `Wardrobe_light.jpeg` | "Your whole closet, digitised and organised" |
| 3 | `Aira_light.jpeg` | "Chat with Aira, your AI personal stylist" |
| 4 | `Saved_light.jpeg` | "Save the looks you'll actually wear" |
| 5 | `Profile_light.jpeg` | "Your Style DNA, tuned to how you dress" |

Production notes:
- Add a short benefit-led caption band above each frame (don't rely on raw screenshots).
- Lead with screens 1–3 — the first 2–3 are what most users see before scrolling.
- Keep light/dark consistent within the set (recommend the light variants for the store set;
  dark variants are available if you prefer a dark theme).
- The `aso-appstore-screenshots` skill can generate final ASO-styled framed images from these
  source screens and the captions above.
- App preview video (optional): a 15–30s capture of Discover → Aira → Saved converts well.

---

## 6. Pre-submission checklist

- [ ] Re-verify every character count in App Store Connect / Play Console (limits are maxima).
- [ ] Confirm final app name (must match binary metadata).
- [ ] Localise if targeting non-English markets (currently `lang=en` only).
- [ ] Generate framed screenshots at required device sizes.
- [ ] Set support URL → https://attira.org/contact.html and privacy URL → https://attira.org/privacy.html
- [ ] After launch, add App Store / Play badges + links to `index.html` and update the
      `SoftwareApplication` JSON-LD with the real store URL(s).
