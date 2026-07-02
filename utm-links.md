# Attira — UTM Tracking Links

Share these UTM-tagged links instead of the plain `https://attira.org/` URL.
Every visit that arrives through one is captured in **PostHog Web Analytics**
(project `454088`), so you can see which channel drives the most traffic and the
most waitlist signups.

**Campaign:** `waitlist_launch`

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

## Where to see the results

1. Go to **PostHog → Web Analytics**: `https://us.posthog.com/project/454088/web`
2. Filter by **Campaign = `waitlist_launch`** (or break the Sources tile down by
   `utm_source`) to rank channels by visits.
3. To see which channel converts best, open the `waitlist_signup` event and break
   it down by `utm_source` — each signup now carries the channel it came from.
4. To rank **subreddits**, filter `utm_source = reddit` and break down by
   `utm_content` (works on both the Sources tile and the `waitlist_signup` event).

## Naming convention (keep links consistent)

UTM values are **case-sensitive** and grouped by exact string match, so always:

- Use **lowercase**, no spaces (use `_` or `-`, e.g. `summer_launch`).
- `utm_source` = the platform: `linkedin`, `twitter`, `instagram`, `producthunt`, `facebook`, `reddit`.
- `utm_medium` = the type of placement: `social` (organic posts), `referral`
  (listings/directories), `bio` (profile link), `cpc` (paid), `email`.
- `utm_campaign` = the marketing push these links belong to: `waitlist_launch`.

Reuse the same `utm_source`/`utm_medium`/`utm_campaign` spellings every time —
a stray `Twitter` vs `twitter` or `social ` with a trailing space shows up as a
separate row in PostHog and splits your numbers.

## Optional extras

- `utm_content` — distinguish links sharing the same source. We use it for the
  **subreddit name** on Reddit links (e.g. `femalefashionadvice`), and you can also
  use it to tell two links in the same post apart (e.g. `hero_button` vs `footer_link`).
- `utm_term` — paid-search keyword (not needed for organic social).
