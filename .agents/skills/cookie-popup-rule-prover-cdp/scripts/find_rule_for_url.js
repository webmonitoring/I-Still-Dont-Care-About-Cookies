#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

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

function getCandidateDomains(domain, includeParents) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  add(domain);

  if (!includeParents) return out;

  const parts = domain.split(".").filter(Boolean);
  for (let i = 1; i < parts.length - 1; i += 1) {
    add(parts.slice(i).join("."));
  }

  return out;
}

function loadRulesObject(rulesFile) {
  const fullPath = path.resolve(rulesFile);
  if (!fs.existsSync(fullPath)) fail(`rules file not found: ${fullPath}`);

  const source = fs.readFileSync(fullPath, "utf8");
  const rulesStart = source.indexOf("const rules = {");
  if (rulesStart === -1) fail("could not find `const rules = {`");

  const openingBrace = source.indexOf("{", rulesStart);
  if (openingBrace === -1) fail("could not locate opening brace for rules object");

  const endMarker = "// end of const rules";
  const rulesEndMarker = source.indexOf(endMarker, rulesStart);
  if (rulesEndMarker === -1) fail("could not find `// end of const rules` marker");

  const body = source.slice(openingBrace + 1, rulesEndMarker);
  const expression = `({${body}\n})`;

  let rules;
  try {
    rules = vm.runInNewContext(expression, Object.create(null), { timeout: 1000 });
  } catch (error) {
    fail(`failed to parse rules object: ${error.message}`);
  }

  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    fail("parsed rules object is invalid");
  }

  return rules;
}

function main() {
  const args = parseArgs(process.argv);
  const rulesFile = args["rules-file"];
  const domainInput = args.domain || args.url;
  const includeParents = args["no-parent"] ? false : true;

  if (!rulesFile) fail("missing --rules-file");
  if (!domainInput) fail("missing --url or --domain");

  const normalizedDomain = normalizeDomain(domainInput);
  if (!normalizedDomain) fail("could not normalize domain");

  const rules = loadRulesObject(rulesFile);
  const candidates = getCandidateDomains(normalizedDomain, includeParents);

  let match = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const rule = rules[candidate];
    if (!rule) continue;
    match = {
      domain: candidate,
      match_type: i === 0 ? "exact" : "parent",
      rule,
    };
    break;
  }

  const result = {
    input: domainInput,
    normalized_domain: normalizedDomain,
    candidates,
    found: Boolean(match),
    match,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
