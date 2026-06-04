# PostHog post-wizard report

The wizard has completed a deep integration of your project. PostHog server-side analytics has been added to the Attira waitlist server using the `posthog-node` SDK. The PostHog client is initialized at startup and shuts down cleanly with the server. Four events are now captured across the waitlist API route, covering every outcome of a signup attempt. User identification is performed on first successful signup so person profiles are created with the submitter's email. Exception autocapture is enabled globally, and server-side errors are also captured explicitly in the `waitlist_signup_failed` event.

| Event | Description | File |
|---|---|---|
| `waitlist_signup` | A new email was successfully added to the waitlist (first-time signup). Also triggers `identify()` to create/update the person profile. | `server.js` |
| `waitlist_signup_existing` | A user submitted the form with an email already on the waitlist. | `server.js` |
| `waitlist_signup_failed` | The waitlist signup request failed due to a server-side error. Also captured via `captureException()`. | `server.js` |
| `waitlist_export_accessed` | An admin successfully authenticated and downloaded the waitlist CSV export, including the row count at time of export. | `server.js` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1668525)
- [New waitlist signups over time](/insights/XNg8eEMS) — daily new signup trend for the last 30 days
- [Total waitlist signups](/insights/vnUfl22e) — all-time bold number count
- [Signup attempts vs new signups](/insights/qU5rH2JF) — bar chart comparing new vs duplicate submissions
- [Cumulative waitlist growth](/insights/9McHUFKG) — running total since launch
- [Waitlist signup errors](/insights/V7TSG68z) — server-side error trend to monitor reliability

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
