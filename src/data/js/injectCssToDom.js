// Inject common.css into the DOM as a <style> tag so it's saved with the page
(function () {
  const styleId = "I-still-dont-care-about-cookies-common-css";

  if (document.getElementById(styleId)) {
    return; // Already injected
  }

  const cssUrl = chrome.runtime.getURL("/data/css/common.css");

  fetch(cssUrl)
    .then((response) => response.text())
    .then((cssContent) => {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = cssContent;
      (document.head || document.documentElement).appendChild(style);
    })
    .catch((err) => console.error("Failed to inject CSS into DOM:", err));
})();

