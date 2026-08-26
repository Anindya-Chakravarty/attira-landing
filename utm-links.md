# Attira — UTM Tracking Links

Share these UTM-tagged links instead of the plain `https://attira.org/` URL.
Every visit that arrives through one is captured in **PostHog Web Analytics**
(project `454088`), so you can see which channel drives the most traffic and the
most waitlist signups.

**Campaigns:** `waitlist_launch` (homepage / waitlist) · `hiring_2026` (careers page)

## Links to share

| Channel | Link |
|---|---|
| **LinkedIn** | `https://attira.org/?utm_source=linkedin&utm_medium=social&utm_campaign=waitlist_launch` |
| **Twitter / X** | `https://attira.org/?utm_source=twitter&utm_medium=social&utm_campaign=waitlist_launch` |
| **Instagram** | `https://attira.org/?utm_source=instagram&utm_medium=social&utm_campaign=waitlist_launch` |
| **Product Hunt** | `https://attira.org/?utm_source=producthunt&utm_medium=referral&utm_campaign=waitlist_launch` |
| **Facebook** | `https://attira.org/?utm_source=facebook&utm_medium=social&utm_campaign=waitlist_launch` |
| **Reddit** (general) | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch` |

> Tip: for an Instagram/Twitter **bio link**, you can swap `utm_medium=social`
> for `utm_medium=bio` to separate bio clicks from feed-post clicks.

### Reddit — by subreddit

All keep `utm_source=reddit` (so Reddit stays one channel) and carry the subreddit
in `utm_content`, so you can rank individual subreddits without splitting the channel.
Use the general Reddit link above only when a post isn't tied to a specific subreddit.

| Subreddit | Link |
|---|---|
| **r/femalefashionadvice** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=femalefashionadvice` |
| **r/fashion** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=fashion` |
| **r/OUTFITS** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=outfits` |
| **r/OOTD** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=ootd` |
| **r/whatshouldIwear** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=whatshouldiwear` |
| **r/capsulewardrobe** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=capsulewardrobe` |
| **r/minimalism** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=minimalism` |
| **r/declutter** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=declutter` |
| **r/Anticonsumption** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=anticonsumption` |
| **r/SideProject** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=sideproject` |
| **r/Startups** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=startups` |
| **r/artificial** | `https://attira.org/?utm_source=reddit&utm_medium=social&utm_campaign=waitlist_launch&utm_content=artificial` |

## Careers — hiring links

These point at `/careers.html`, not the homepage, and use their own campaign
(`hiring_2026`) so recruiting traffic never mixes into the waitlist numbers.

| Channel | Link |
|---|---|
| **Wellfound** | `https://attira.org/careers.html?utm_source=wellfound&utm_medium=referral&utm_campaign=hiring_2026` |

`utm_medium=referral` because Wellfound is a listing/directory — the same medium
Product Hunt uses above. Keep it that way rather than inventing `job_board`.

If you post several roles and want to tell the listings apart, add `utm_content`
with the role slug (same pattern as the subreddits), keeping the other three
values identical:

```
…&utm_campaign=hiring_2026&utm_content=content-design-lead
…&utm_campaign=hiring_2026&utm_content=design-social-associate
```

> **Caveat — only `utm_source` reaches the application record.** The apply form
> reads all five UTM keys (`careers.js` → `readUtm`) and the server sanitises all
> five, but the insert in `server.js` passes only `utm_source`, and the
> `applications` table in `careers-db.js` only has a `utm_source` column. So
> "how many applicants came from Wellfound" works, but `utm_content` is visible
> only in PostHog pageviews — it is **not** attached to the individual
> application. Widening the table needs a new entry in `ADD_COLUMNS` plus the
> matching fields in `COLUMNS` and the `addApplication` call.

Applying through Wellfound's own hosted form bypasses the site entirely, so
those applicants carry no UTM at all — only clicks through to `attira.org` are
tracked.

## Where to see the results

1. Go to **PostHog → Web Analytics**: `https://us.posthog.com/project/454088/web`
2. Filter by **Campaign = `waitlist_launch`** (or break the Sources tile down by
   `utm_source`) to rank channels by visits.
3. To see which channel converts best, open the `waitlist_signup` event and break
   it down by `utm_source` — each signup now carries the channel it came from.
4. To rank **subreddits**, filter `utm_source = reddit` and break down by
   `utm_content` (works on both the Sources tile and the `waitlist_signup` event).
5. For **hiring**, filter Campaign = `hiring_2026` (or Path = `/careers.html`) to
   see clicks per job board, and break the `career_application_received` event
   down by `utm_source` to see which board actually produced applications.

## Naming convention (keep links consistent)

UTM values are **case-sensitive** and grouped by exact string match, so always:

- Use **lowercase**, no spaces (use `_` or `-`, e.g. `summer_launch`).
- `utm_source` = the platform: `linkedin`, `twitter`, `instagram`, `producthunt`, `facebook`, `reddit`, `wellfound`.
- `utm_medium` = the type of placement: `social` (organic posts), `referral`
  (listings/directories, incl. job boards), `bio` (profile link), `cpc` (paid), `email`.
- `utm_campaign` = the marketing push these links belong to: `waitlist_launch`
  (homepage/waitlist) or `hiring_2026` (careers page).

Reuse the same `utm_source`/`utm_medium`/`utm_campaign` spellings every time —
a stray `Twitter` vs `twitter` or `social ` with a trailing space shows up as a
separate row in PostHog and splits your numbers.

## Optional extras

- `utm_content` — distinguish links sharing the same source. We use it for the
  **subreddit name** on Reddit links (e.g. `femalefashionadvice`), and you can also
  use it to tell two links in the same post apart (e.g. `hero_button` vs `footer_link`).
- `utm_term` — paid-search keyword (not needed for organic social).
