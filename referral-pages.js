// Shared stateless invitation renderer for Express and the isolated edge routes.
function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInvitePage({ creatorCode, platform, fallbackUrl, publicCreatorConfig, appScheme }) {
  const title = "Join Attira — your personal pocket stylist";
  const description = "A friend shared Attira with you. Build outfits from your own wardrobe, try them on, and find your style.";

  return (`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${htmlEscape(title)}</title>
<meta name="description" content="${htmlEscape(description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Attira" />
<meta property="og:title" content="${htmlEscape(title)}" />
<meta property="og:description" content="${htmlEscape(description)}" />
<meta property="og:url" content="${htmlEscape(`${publicCreatorConfig.webUrl}/invite/${creatorCode}`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(title)}" />
<meta name="twitter:description" content="${htmlEscape(description)}" />
</head>
<body>
<div id="inviteRoot"
  data-code="${htmlEscape(creatorCode)}"
  data-platform="${htmlEscape(platform)}"
  data-api-base="${htmlEscape(publicCreatorConfig.apiBase)}"
  data-android-url="${htmlEscape(publicCreatorConfig.androidStoreUrl)}"
  data-app-scheme="${htmlEscape(appScheme || 'attira')}"
  data-fallback-url="${htmlEscape(fallbackUrl)}">
  <h1>A little gift. For both of you.</h1>
  <p>Install Attira, then return here and tap Open Attira to connect your invitation.</p>
  <p>Your code: <strong>${htmlEscape(creatorCode)}</strong></p>
  <p><a id="inviteInstall" href="${htmlEscape(fallbackUrl)}">Get Attira</a></p>
  <p><a id="inviteOpen" hidden>Open Attira</a></p>
  <p id="inviteStatus" role="status">Preparing your invitation…</p>
  <noscript><p><a href="${htmlEscape(fallbackUrl)}">Continue to Attira</a></p></noscript>
</div>
<script src="/invite.js?v=1"></script>
</body>
</html>`);
}

module.exports = { htmlEscape, renderInvitePage };
