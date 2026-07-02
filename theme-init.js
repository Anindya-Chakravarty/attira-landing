/* Pre-paint theme setter — runs blocking in <head> before styles.css so the
   theme is applied before first paint (no flash of the wrong theme).
   Kept as an external file (not inline) to satisfy the strict `script-src 'self'`
   CSP. Default is DARK: we apply dark unless the visitor has explicitly chosen
   light (persisted by the homepage toggle). */
(function () {
  try {
    if (localStorage.getItem("attira-theme") !== "light") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {
    // No storage access → still default to dark.
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
