# Attira — waitlist email capture

The landing page's "Get early access" form now saves every email into a small
local database so you can personally reach out to people who sign up.

## One-time setup

```bash
cd /Users/anindyachakravarty/Desktop/PH_Trial/website
npm install
```

## Run the site

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

> Important: open the site through `http://localhost:3000` (the server), **not**
> by double-clicking `index.html`. Only the server can save emails to the database.

Every email submitted is stored in **`data/waitlist.db`** (created automatically).

## Get the emails (to reach out)

Run this anytime — it writes a spreadsheet you can open in Excel / Google Sheets:

```bash
npm run export
```

This creates **`data/waitlist.csv`** with one row per signup:
`id, email, source, user_agent, created_at`.

### Optional: download the CSV from the browser

Set an admin key when starting the server, then visit the export URL with it:

```bash
ADMIN_KEY="pick-a-secret" npm start
# then open:
# http://localhost:3000/api/waitlist/export?key=pick-a-secret
```

Without `ADMIN_KEY` set, that URL stays disabled (use `npm run export` instead).

## Notes

- Duplicate emails are ignored automatically (each address is stored once).
- `data/` and `node_modules/` are git-ignored, so your email list and the
  database never get committed.
- Check how many signups you have: `http://localhost:3000/api/waitlist/count`
