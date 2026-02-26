---
name: cookie-popup-rule-prover-cdp
description: Build and verify site-specific popup blocking rules for the "I still don't care about cookies" extension using the Chrome DevTools CDP autoconnect MCP. Use when a user gives one or more URLs and wants before/after screenshots, iterative in-browser rule testing, and final rules written to a rules.js file.
---

# Cookie Popup Rule Prover (CDP)

Follow this workflow whenever a user asks to block popups/overlays for a site and prove it with screenshots, using Chrome CDP autoconnect tools.

## Popup Scope Definition

Treat a "popup" as any UI that a user would reasonably consider obstructive because it covers or blocks page content or interaction and is typically removable via user interaction (close, accept, reject, continue, enter age, choose location, dismiss promo, etc.).

In scope examples:

- age gates and age verification prompts
- cookie/consent modals and full-screen overlays
- geo/location pickers
- newsletter/promo lead-capture modals
- delayed/chained overlays that appear after another popup is removed

Out of scope unless explicitly requested:

- core page content that is not an overlay/prompt
- non-obstructive fixed UI that does not block interaction

## Inputs

Collect:

- one or more target URLs
- rules file path
  - default: `src/data/rules.js`

## Required Outputs

Produce all of:

- one before screenshot captured after ~10s (popups visible if present at that point)
- final rule entry added/updated in `data/rules.js`
- after screenshot (popups gone, page usable)
- short verification summary

## Workflow (CDP)

1. Normalize input into a URL list.
2. For each URL, run the full loop in order:
   - open or select a Chrome page with CDP autoconnect
   - navigate to target URL in a clean state (clear storage/cookies when possible)
   - wait ~10s after navigation
   - capture exactly one before screenshot: `<domain>-before-rules.png`
   - inspect popup/overlay DOM with CDP snapshot/evaluate (including shadow-host elements and iframe/container hosts)
   - build a candidate `s` CSS rule
   - inject candidate CSS via CDP `evaluate_script` and verify
   - run delayed DOM-only checks (no extra before screenshots) for late/chained popups
   - if new blockers appear, append selectors and re-verify
   - iterate selectors until pass criteria are met
   - upsert final domain rule in selected `rules.js`
   - re-open/reload in a clean state and validate with delayed checks
   - capture after screenshot: `<domain>-after-rules.png`
3. Confirm every domain rule exists in file with `rg`.

## Rule Construction Guidelines

Default to `s` rules. Prefer precise, stable selectors:

- IDs first: `#banner`, `#overlay`
- stable attributes and host selectors next: `[data-*]`, `[aria-*]`, custom element tags
- vendor-specific classes next: `.pd-cookie-banner-window`
- include backdrop + modal + launcher if they block interaction
- when popup UI is rendered in shadow DOM, target the host element in the main DOM
- when content is inside cross-origin iframe, target the iframe/container in the parent DOM
- add unlock styles only when needed:
  - `html,body{overflow:auto!important;position:static!important;height:auto!important}`

Avoid brittle selectors:

- deeply nested positional chains
- broad global selectors that can hide legit page content

Use `c` only when an existing reusable common rule already matches.
Use `j` only when CSS is not enough and a known handler applies.

## Live Browser Verification (CDP)

After injecting candidate CSS, verify:

- target popup/backdrop elements are hidden
- `html` and `body` are no longer locked (`overflow` not `hidden`)
- no full-page dim overlay blocks pointer input
- no delayed/chained popup appears during follow-up DOM checks

If the page looks black, an overlay/backdrop is still active or body scroll lock remains.

## Writing Rule Into Extension

Use helper script:

```bash
node skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --domain "<domain>" \
  --css "<css-rule-string>"
```

Or load CSS from file:

```bash
node skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --domain "<domain>" \
  --css-file "/tmp/<domain>-rule.css"
```

Then verify:

```bash
rg -n "\"<domain>\"" "<rules-file>"
```

You can also pass URL directly instead of domain:

```bash
node skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --url "https://example.com/product/abc" \
  --css-file "/tmp/example-rule.css"
```

For known rules, batch upsert multiple entries:

```bash
node skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --batch-file "/tmp/rules-batch.json"
```

Batch file format:

```json
[
  { "url": "https://a.com/product/x", "css": "#popup{display:none!important}" },
  { "domain": "b.com", "cssFile": "./b-rule.css" }
]
```

## Completion Checklist

Finish only when all are true:

- one before screenshot exists (captured after ~10s) and one after screenshot exists for each URL
- after screenshot shows no blocking popup/overlay for each URL
- every domain rule is present in selected `rules.js`
- user gets file paths and a concise explanation of what was blocked per URL
