<div align="center">

<img src="src/icons/128.png" />
  
# I still don't care about cookies

### Debloated fork of the extension "I don't care about cookies"

#### Get rid of cookie warnings from almost all websites!

<a href="https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/OhMyGuus/I-Still-Dont-Care-About-Cookies.svg?logo=github&style=for-the-badge"></a>
<a href="https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases"><img alt="Releases" src="https://img.shields.io/github/downloads/OhMyGuus/I-Still-Dont-Care-About-Cookies/total?color=blue&label=downloads&style=for-the-badge"></a>
<a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge"></a>

</div>

## Why fork?

This extension has been acquired by _**[Avast](https://en.wikipedia.org/wiki/Avast)**_ (which itself has been acquired by _[Gen Digital Inc.](https://en.wikipedia.org/wiki/Gen_Digital)_, a large tech conglomerate) and I simply don't trust Avast with my data. Additionally, having it on GitHub allows us to improve the code and add support for websites faster.

## Download & Install

<a href="https://addons.mozilla.org/en-US/firefox/addon/istilldontcareaboutcookies"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt='Get the Extension on Firefox' height="75"></a>
<a href="https://chrome.google.com/webstore/detail/i-still-dont-care-about-c/edibdbjcniadpccecjdfdjjppcpchdlm"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/HRs9MPufa1J1h5glNhut.png" alt="Get the Extension on Chrome" height="75" style="border: 1px solid transparent; border-radius:6px;"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/i-still-dont-care-about-/kkacdgacpkediooahopgcbdahlpipheh"><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Get_it_from_Microsoft_Badge.svg/320px-Get_it_from_Microsoft_Badge.svg.png" alt="Get the Extension on Edge" height="75" style="border: 1px solid transparent; border-radius:4px;"></a>

## Manual installation

- [Installation guide for **Firefox**](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/wiki/Firefox-installation-guide)
- [Installation guide for **Chrome**](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/wiki/Chrome-installation-guide)

## Contributing to Translation

We welcome contributions to the translation of the extension. If you're interested in helping us translate the extension to your language, you can join us on [Crowdin](https://crowdin.com/project/i-still-dont-care-about-cookie/).

## Contributing to The API

This extension sends requests to an API hosted at _[api.istilldontcareaboutcookies.com](https://api.istilldontcareaboutcookies.com)_ - while this is a backend-facing piece of software, the source code is available [here on GitHub](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies-Api) and uses the C# ASP.NET library for an MVC structure.

## License

This fork is based on [**v3.4.3**](https://addons.mozilla.org/firefox/addon/i-dont-care-about-cookies/versions/) of the extension, which has been distributed under the GPLv3 (GNU) license.

## Credits / spotlights

- [OhMyGuus](https://github.com/OhMyGuus/) - Current maintainer of this
- [appeasementPolitik](https://github.com/appeasementPolitik) - Helped a lot with setting up and maintaining the project. (Thanks!)
- [Translators](https://crowdin.com/project/i-still-dont-care-about-cookie/members) - Awesome people who translated (Thanks!)
- [All other contributors](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/graphs/contributors) (Thanks!)
- [Daniel Kladnik](https://www.linkedin.com/in/dkladnik) - Developer of original extension
- Everyone who reported a website.

## Thanks to all contributors

We would like to extend our gratitude to all the contributors, translators, and everyone who has helped make this extension possible. Your efforts and support are highly appreciated, and we could not have done it without you. Thank you!

<a href="https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/graphs/contributors">
  <img alt="List of contributors to this repository" src="https://contrib.rocks/image?repo=OhMyGuus/I-Still-Dont-Care-About-Cookies" />
</a>

## AI Rule Prover Skills

This repository includes Codex skill files to speed up adding and validating site-specific popup rules in `src/data/rules.js`.

- `skills/cookie-popup-rule-prover`: browser-driven workflow for rule discovery and proof.
- `.agents/skills/cookie-popup-rule-prover-cdp`: Chrome CDP workflow (autoconnect/proxy MCP) for the same task.

### What the workflow does

For each URL (single or batch):

1. Wait about 10 seconds, then capture one **before** screenshot.
2. Inspect DOM and build a candidate `s` rule (CSS selector rule).
3. Inject that exact CSS rule string live in the page and verify blockers are gone.
4. Run delayed DOM checks for chained/late popups (without taking extra before screenshots) and expand selectors if needed.
5. Upsert the final rule into `src/data/rules.js`.
6. Capture one **after** screenshot.

### Run with Chrome MCP (batch URLs)

Use the Chrome CDP skill to process multiple URLs in one run:

```text
$cookie-popup-rule-prover-cdp with rules-file src/data/rules.js and urls:
https://site-a.com/product/1
https://site-b.com/product/2
https://site-c.com/product/3
```

This invocation uses the Chrome DevTools CDP MCP workflow to discover rules, validate them in-browser, write them to `src/data/rules.js`, and capture before/after screenshots per URL.

When using production feedback as input, pass the real fetched URLs to the skill. The skill groups and deduplicates them by normalized domain internally, then assigns domain jobs across `chrome-devtools-a`, `chrome-devtools-b`, `chrome-devtools-c`, and `chrome-devtools-d`.

`npm run create-feedback-rules-prompt` checks these Chrome MCP workers by default and adds any missing workers with `codex mcp add`. To check them manually:

```bash
codex mcp list | rg 'chrome-devtools-(a|b|c|d)'
```

If they are missing and you want to add them without running the fetch script:

```bash
codex mcp add chrome-devtools-a -- npx chrome-devtools-mcp@latest --headless=true --isolated=true
codex mcp add chrome-devtools-b -- npx chrome-devtools-mcp@latest --headless=true --isolated=true
codex mcp add chrome-devtools-c -- npx chrome-devtools-mcp@latest --headless=true --isolated=true
codex mcp add chrome-devtools-d -- npx chrome-devtools-mcp@latest --headless=true --isolated=true
```

### Create a feedback rules prompt

Use `npm run create-feedback-rules-prompt` to fetch recent production feedback URLs that mention popups, then print a prompt to paste into Codex with `$cookie-popup-rule-prover-cdp`:

```bash
export PROD_DB_PASSWORD='your-production-mysql-password'
npm run create-feedback-rules-prompt
```

The script checks/installs the required Chrome MCP workers, starts the local SSH tunnel if needed, connects to MySQL through `127.0.0.1:3307`, and prints a prompt from the fetched URLs so the active Codex session can deduplicate domains and generate verified rules.

For the SSH tunnel, the script uses `~/.ssh/jump_host_key` when that file exists. Otherwise it lets SSH use your `~/.ssh/config`, ssh-agent, or default keys such as `~/.ssh/id_ed25519`. If your key has a different name, pass it explicitly:

```bash
npm run create-feedback-rules-prompt -- --jump-key ~/.ssh/my-devweb-key
```

For test runs, limit the output:

```bash
npm run create-feedback-rules-prompt -- --limit 10
```

To only inspect the fetched URLs without running Codex:

```bash
npm run create-feedback-rules-prompt -- --fetch-only --limit 10
```

To try the non-interactive Codex CLI flow anyway:

```bash
npm run create-feedback-rules-prompt -- --run-codex --limit 10
```

To write to a different rules file:

```bash
npm run create-feedback-rules-prompt -- --rules-file src/data/rules.js --limit 10
```

### Why screenshots are valid proof even without loading the extension

For `s` rules, the extension behavior is CSS injection/hiding behavior on matched selectors. The workflow validates the same mechanism by injecting the **exact same CSS string** that will be written to `src/data/rules.js` and then checking:

- popup/backdrop elements become hidden
- body/html scroll lock is released when needed
- page is interactable in the after screenshot

That makes before/after screenshots a practical proof that the rule logic itself works.

### Important caveat

This proof validates the **rule semantics** (`s` CSS) directly. It does not fully validate extension lifecycle concerns (timing/order/service worker startup in browser extension runtime). For high-confidence release checks, run one final pass with the extension loaded in Chrome.

### Batch updates

Both skills and helper scripts support multiple URLs:

- pass multiple URLs to the skill invocation
- or use batch upsert with `--batch-file` JSON entries (`url`/`domain` + `css`/`cssFile`)

### Local CSS Preview Script

Use [`preview-css-rule.js`](preview-css-rule.js) to preview how a rule would affect a page directly in DevTools Console.

- update the `CSS` constant with the rule you want to test
- open the target site, paste script in console, and run it
- the script keeps the style present and exposes `__isdcCleanup()` to remove it

This is useful to quickly validate what the browser should look like with the rule applied before writing to `src/data/rules.js`.
