---
name: cookie-popup-rule-prover-cdp
description: Build and verify site-specific popup blocking rules for the "I still don't care about cookies" extension using Chrome DevTools CDP MCP servers in parallel (`chrome-devtools-a|b|c|d`). Use when a user gives one or more URLs and wants before/after screenshots, iterative in-browser rule testing, and final rules written to a rules.js file.
---

# Cookie Popup Rule Prover (CDP)

Follow this workflow whenever a user asks to block popups/overlays for one or more sites and prove it with screenshots, using Chrome CDP MCP tools.

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

## Existing Rule Preflight (Reuse First)

Before building new selectors for a domain, check whether `rules.js` already contains an exact or parent-domain rule:

```bash
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/find_rule_for_url.js \
  --rules-file "<rules-file>" \
  --url "<target-url>"
```

Behavior:

- if an existing rule is found, inject it first and run full quality gates on the current URL
- for multi-URL domains, the existing rule must pass across all actionable URLs in that domain job
- if it passes, reuse it (no rule change/upsert needed)
- if it partially fails, extend/replace selectors and then upsert

## MCP Topology (Parallel Workers)

Use four isolated Chrome MCP servers as the default worker pool:

- `chrome-devtools-a`
- `chrome-devtools-b`
- `chrome-devtools-c`
- `chrome-devtools-d`

Map each domain job to a worker slot and process domains in parallel when possible.

- First group input URLs by normalized domain (same host/domain goes to one domain job).
- If `D <= 4`, assign one domain job per worker.
- If `D > 4`, shard domain jobs round-robin across the four workers.
- Keep each worker scoped to one domain at a time.
- Process URLs within the same domain job sequentially on that worker.
- If any worker is unavailable, continue with remaining workers and note reduced concurrency.

## Required Outputs

Produce all of:

- one before screenshot captured after ~10s (popups visible if present at that point) for each tested URL, saved under the run proof directory
- one after screenshot for each tested URL, saved under the run proof directory
- one final rule entry added/updated in `data/rules.js` per domain
- short verification summary

## Proof Artifact Layout

Store every proof artifact for a run under one deterministic repo-local directory:

```text
proofs/run-<YYYYMMDD-HHMMSS>/
```

Create the run directory before opening browser pages. Use local time for the timestamp. If that directory already exists, append `-2`, `-3`, etc.

Inside the run directory, use this layout:

```text
proofs/run-<timestamp>/
├── screenshots/
│   ├── <domain>/
│   │   ├── <url-slug>-before.png
│   │   └── <url-slug>-after.png
├── worker-results/
│   └── <domain>.json
└── summary.json
```

Rules:

- write all screenshots, worker JSON, and aggregate summaries inside this run directory
- use lowercase normalized domains for directory and result filenames
- create URL slugs from pathname/search text; fall back to `home` for root pages
- keep slugs filesystem-safe and stable: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, and cap near 80 characters
- when multiple URLs in the same domain resolve to the same slug, append `-2`, `-3`, etc.
- include the proof paths in the final user-facing summary

## Workflow (CDP)

1. Normalize input into a URL list and group by normalized domain.
2. Create the run proof directory using the Proof Artifact Layout.
3. Assign domain jobs to `chrome-devtools-a|b|c|d` workers and execute domain loops in parallel.
4. For each domain job, run each domain URL sequentially on its assigned worker:
   - open or select a Chrome page with the assigned CDP server
   - navigate to target URL in a clean state (clear storage/cookies when possible)
   - if this is the first URL for the domain, run existing-rule preflight and inject existing CSS when found
   - wait ~10s after navigation
   - capture before screenshot to `proofs/run-<timestamp>/screenshots/<domain>/<url-slug>-before.png`
   - inspect popup/overlay DOM with CDP snapshot/evaluate (including shadow-host elements and iframe/container hosts)
   - build a candidate `s` CSS rule
   - inject candidate CSS via CDP `evaluate_script` and verify
   - run delayed DOM-only checks (no extra before screenshots) for late/chained popups
   - if new blockers appear, append selectors and re-verify
   - re-scan for newly revealed overlays after each hide (common pattern: age-gate removed, then newsletter modal appears)
   - persist URL-level findings into the current domain job accumulator
   - capture after screenshot to `proofs/run-<timestamp>/screenshots/<domain>/<url-slug>-after.png`
5. Write per-domain worker JSON to `proofs/run-<timestamp>/worker-results/<domain>.json`.
6. Build one domain-level CSS rule from all successful actionable URLs in the domain job (or keep the reused existing rule when no edits are needed).
7. If workers return per-URL and/or per-domain JSON outputs, aggregate them and apply all rules in one pass:

```bash
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/aggregate_worker_results.mjs \
  --rules-file "<rules-file>" \
  --results-dir "proofs/run-<timestamp>/worker-results" \
  --summary-file "proofs/run-<timestamp>/summary.json"
```

By default, noop CSS entries (for example `.__codex_noop__`) are skipped. Use `--allow-noop` only when intentionally aggregating verified no-popup domains.

By default, unverified worker entries are rejected by the aggregator. Use `--allow-unverified` only for manual/debug flows.

8. Confirm every applied domain rule exists in file with `rg`.

### Worker Result Contract (Required For Safe Upserts)

For domain jobs with multiple URLs, prefer one JSON file per domain with URL-level details:

```json
{
  "domain": "example.com",
  "status": "ok",
  "css": "#popup{display:none!important}html,body{overflow:auto!important}",
  "per_url_results": [
    {
      "url": "https://example.com/a",
      "status": "ok",
      "css": "#popup{...}",
      "verification": {
        "passed": true,
        "before_popup_count": 2,
        "after_popup_count": 0,
        "after_popup_detected": false,
        "after_backdrop_blur": false
      },
      "artifacts": {
        "before_screenshot": "proofs/run-<timestamp>/screenshots/example.com/a-before.png",
        "after_screenshot": "proofs/run-<timestamp>/screenshots/example.com/a-after.png"
      }
    },
    { "url": "https://example.com/b", "status": "blocked_by_security", "reason": "challenge" }
  ]
}
```

The aggregator also accepts multiple files for the same domain and merges them by domain.

Verification requirements:

- every actionable URL entry must include `verification` (or `qa`) unless intentionally bypassing with `--allow-unverified`
- `verification.passed` must not be `false`
- `verification.after_popup_detected` must not be `true`
- numeric after-count fields must be `0` when provided (for example `after_popup_count`)
- blur/backdrop flags must be `false` when provided (for example `after_backdrop_blur`)

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

Run all 3 detectors before marking success:

1. Semantic detector:
- dialog/modal/cookie/age/newsletter selectors and text cues

2. Structural detector (keywordless overlay catch):
- visible `fixed`/`sticky`/`absolute` layers with high z-index or large viewport coverage
- treat full-viewport layers as blockers even if they contain no cookie/consent keywords

3. Blur/backdrop detector:
- any persistent page-dimming/blur layer (`backdrop-filter`, `filter: blur`, dim backdrops) after rule injection

## Quality Gates (Must Pass Before Upsert)

Do not mark a URL as success unless all checks pass:

- no visible full-screen or large fixed overlay remains (`position: fixed/sticky` + high z-index and modal/popup semantics)
- no visible dialog remains (`[role="dialog"]`, `[aria-modal="true"]`, common vendor modal hosts)
- no dimmed backdrop still covering most of the viewport
- no keywordless full-screen overlay remains (even transparent/empty wrappers)
- no residual blur/backdrop-filter effect remains on top-level content
- page interaction/scroll is restored
- after screenshot visibly differs from before where a popup existed

If a popup remains in the after screenshot, the worker result must be `status: "failed"` (or equivalent non-success) and must not be upserted.

Domain-level pass criteria:

- every actionable URL for the domain must pass quality gates
- blocked/challenge URLs are explicitly marked and excluded from actionable pass count
- if all URLs for a domain are blocked/challenged, do not upsert that domain
- every actionable URL includes verification evidence in worker JSON

## Security/Challenge Handling

Some domains (finance/auth flows, bot-protected pages) may redirect into login/challenge/security screens where popup verification is not reproducible.

For those cases:

- set worker result to non-success status such as `blocked_by_security`
- include a short `reason`
- do not emit noop CSS as a success
- do not upsert a rule for that domain

## Writing Rule Into Extension

Use helper script:

```bash
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --domain "<domain>" \
  --css "<css-rule-string>"
```

Or load CSS from file:

```bash
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
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
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
  --rules-file "<rules-file>" \
  --url "https://example.com/product/abc" \
  --css-file "/tmp/example-rule.css"
```

For known rules, batch upsert multiple entries:

```bash
node .agents/skills/cookie-popup-rule-prover-cdp/scripts/upsert_rule_entry.js \
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

- one before screenshot exists (captured after ~10s) and one after screenshot exists for each tested URL
- all screenshots, worker JSON, and summary JSON live under one `proofs/run-<timestamp>/` directory
- after screenshot shows no blocking popup/overlay for each actionable URL
- worker JSON for actionable URLs includes verification evidence with zero after-popup indicators
- every applied domain rule is present in selected `rules.js`
- any blocked/challenge domains are explicitly reported as not-upserted
- parallel domain-worker assignment and any worker failures/degraded concurrency are reported
- user gets the run proof directory path, screenshot paths, and a concise explanation of what was blocked per URL
