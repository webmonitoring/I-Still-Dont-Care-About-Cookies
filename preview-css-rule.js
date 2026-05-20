(() => {
  const CSS =
    "#age_okay_container,#age_okay_overlay,#age_okay_fix{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}html{overflow:hidden!important;height:100%!important;}body,body.age_okay_body{overflow-y:auto!important;overflow-x:hidden!important;height:100vh!important;max-height:100vh!important;position:relative!important;}";
  const ID = "isdc-test-style";

  function ensureStyle() {
    let s = document.getElementById(ID);
    if (!s) {
      s = document.createElement("style");
      s.id = ID;
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }
  }

  ensureStyle();

  // Restore the test style if the site removes it while previewing.
  const root = document.head || document.documentElement;
  const observer = new MutationObserver(() => {
    if (!document.getElementById(ID)) ensureStyle();
  });
  observer.observe(root, { childList: true });

  window.__isdcCleanup = () => {
    observer.disconnect();
    document.getElementById(ID)?.remove();
  };

  console.log("Injected safely. Use __isdcCleanup() to undo.");
})();
