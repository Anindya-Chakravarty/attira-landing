<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Attira waitlist server. The project already had `posthog-node` installed and the SDK initialized in `server.js`. Two new server-side events were added to fill gaps in waitlist funnel visibility: one capturing invalid email submissions (form quality / UX signal) and one capturing rate-limit hits (anti-spam / bot activity signal). Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were confirmed and updated in `.env`.

| Event | Description | File |
|-------|-------------|------|
| `waitlist_signup` | New email successfully added to the waitlist | `server.js` (existing) |
| `waitlist_signup_existing` | Submitted email was already on the waitlist | `server.js` (existing) |
| `waitlist_signup_failed` | Server error while inserting the email (DB failure etc.) | `server.js` (existing) |
| `waitlist_export_accessed` | Admin downloaded the waitlist CSV via the API | `server.js` (existing) |
| `waitlist_invalid_email` | Waitlist form submitted with an invalid email address | `server.js` (added) |
| `waitlist_rate_limited` | Client hit the rate limiter on `POST /api/waitlist` | `server.js` (added) |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/454088/dashboard/1684060)
- [Total waitlist signups](https://us.posthog.com/project/454088/insights/ihPvIdjl) — single bold number showing all-time new signups
- [Waitlist signup growth](https://us.posthog.com/project/454088/insights/xJuiDJhC) — cumulative growth curve over the last 90 days
- [Signup attempt outcomes](https://us.posthog.com/project/454088/insights/t3lDrJ9c) — bar chart comparing new signups, duplicate submissions, and invalid emails
- [Daily new vs returning signups](https://us.posthog.com/project/454088/insights/mHxapDsC) — line chart showing first-time vs repeat email submissions
- [Errors and blocks](https://us.posthog.com/project/454088/insights/OYB6dp1J) — server errors and rate-limit blocks over time

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
