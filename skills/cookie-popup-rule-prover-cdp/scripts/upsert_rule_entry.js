#!/usr/bin/env node

/**
 * Upsert a domain entry inside the `const rules = { ... }` section of rules.js.
 *
 * Example:
 * node skills/cookie-popup-rule-prover/scripts/upsert_rule_entry.js \
 *   --rules-file "src/data/rules.js" \
 *   --domain "example.com" \
 *   --css "#cookie-banner{display:none!important}html,body{overflow:auto!important}"
 */

import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function normalizeDomain(input) {
  if (!input) return "";
  const value = String(input).trim();
  if (!value) return "";

  let hostname = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      hostname = new URL(value).hostname;
    } catch {
      fail(`invalid URL: ${value}`);
    }
  }

  return hostname.replace(/^www\./i, "").toLowerCase();
}

function normalizeCss(css) {
  return css
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeJsString(input) {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findMatchingBrace(text, openingBraceIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openingBraceIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function upsertRule({ rulesFile, domain, css }) {
  const fullPath = path.resolve(rulesFile);
  if (!fs.existsSync(fullPath)) {
    fail(`rules file not found: ${fullPath}`);
  }

  const source = fs.readFileSync(fullPath, "utf8");
  const rulesStart = source.indexOf("const rules = {");
  if (rulesStart === -1) fail("could not find `const rules = {`");

  const endMarker = "// end of const rules";
  const rulesEndMarker = source.indexOf(endMarker, rulesStart);
  if (rulesEndMarker === -1) fail("could not find `// end of const rules` marker");

  const rulesBody = source.slice(rulesStart, rulesEndMarker);
  const domainNeedle = `"${domain}":`;
  const localDomainIndex = rulesBody.indexOf(domainNeedle);

  const escapedCss = escapeJsString(normalizeCss(css));
  const entry = `  "${domain}": {\n    s: "${escapedCss}",\n  },\n`;

  let updated;
  let action;

  if (localDomainIndex !== -1) {
    const globalDomainIndex = rulesStart + localDomainIndex;
    const entryStart = source.lastIndexOf("\n", globalDomainIndex) + 1;
    const openingBraceIndex = source.indexOf("{", globalDomainIndex);
    if (openingBraceIndex === -1 || openingBraceIndex > rulesEndMarker) {
      fail(`could not parse existing entry for domain: ${domain}`);
    }

    const closingBraceIndex = findMatchingBrace(source, openingBraceIndex);
    if (closingBraceIndex === -1 || closingBraceIndex > rulesEndMarker) {
      fail(`could not find matching brace for domain: ${domain}`);
    }

    let entryEnd = closingBraceIndex + 1;
    while (entryEnd < source.length && /\s/.test(source[entryEnd]) && source[entryEnd] !== "\n") {
      entryEnd += 1;
    }
    if (source[entryEnd] === ",") entryEnd += 1;
    if (source[entryEnd] === "\r") entryEnd += 1;
    if (source[entryEnd] === "\n") entryEnd += 1;

    updated = `${source.slice(0, entryStart)}${entry}${source.slice(entryEnd)}`;
    action = "updated";
  } else {
    updated = `${source.slice(0, rulesEndMarker)}${entry}\n${source.slice(rulesEndMarker)}`;
    action = "inserted";
  }

  fs.writeFileSync(fullPath, updated, "utf8");
  console.log(`${action} domain rule for ${domain} in ${fullPath}`);
}

function readCss({ css, cssFile, baseDir = process.cwd() }) {
  if (!css && !cssFile) fail("provide css or cssFile");
  if (css && cssFile) fail("use only one of css or cssFile");
  if (css) return css;

  const cssPath = path.resolve(baseDir, cssFile);
  if (!fs.existsSync(cssPath)) fail(`css file not found: ${cssPath}`);
  return fs.readFileSync(cssPath, "utf8");
}

function runBatch({ rulesFile, batchFile }) {
  const batchPath = path.resolve(batchFile);
  if (!fs.existsSync(batchPath)) fail(`batch file not found: ${batchPath}`);

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  } catch (error) {
    fail(`invalid batch JSON: ${error.message}`);
  }

  if (!Array.isArray(entries)) {
    fail("batch JSON must be an array of objects");
  }

  const batchDir = path.dirname(batchPath);
  let count = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const domain = normalizeDomain(entry.domain || entry.url);
    if (!domain) fail("batch entry is missing domain or url");
    const css = readCss({
      css: entry.css,
      cssFile: entry.cssFile,
      baseDir: batchDir,
    });
    upsertRule({ rulesFile, domain, css });
    count += 1;
  }

  console.log(`processed ${count} batch entr${count === 1 ? "y" : "ies"} from ${batchPath}`);
}

function main() {
  const args = parseArgs(process.argv);
  const rulesFile = args["rules-file"];
  const domain = normalizeDomain(args.domain || args.url);
  const css = args.css;
  const cssFile = args["css-file"];
  const batchFile = args["batch-file"];

  if (!rulesFile) fail("missing --rules-file");
  if (batchFile) {
    if (domain || css || cssFile) {
      fail("when using --batch-file, do not pass --domain/--url/--css/--css-file");
    }
    runBatch({ rulesFile, batchFile });
    return;
  }

  if (!domain) fail("missing --domain or --url");
  const cssContent = readCss({ css, cssFile });
  upsertRule({ rulesFile, domain, css: cssContent });
}

main();
