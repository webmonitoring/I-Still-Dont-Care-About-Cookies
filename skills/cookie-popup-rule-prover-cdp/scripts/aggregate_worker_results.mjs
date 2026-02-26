#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
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
      return "";
    }
  }

  return hostname.replace(/^www\./i, "").toLowerCase();
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`invalid JSON in ${filePath}: ${error.message}`);
  }
}

function listResultFiles({ resultsDir, resultsFile }) {
  const files = new Set();

  if (resultsDir) {
    const dir = path.resolve(resultsDir);
    if (!fs.existsSync(dir)) fail(`results dir not found: ${dir}`);
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
    for (const file of entries) files.add(file);
  }

  if (resultsFile) {
    const values = Array.isArray(resultsFile) ? resultsFile : [resultsFile];
    for (const raw of values) {
      const split = String(raw)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const entry of split) {
        const fullPath = path.resolve(entry);
        if (!fs.existsSync(fullPath)) fail(`results file not found: ${fullPath}`);
        files.add(fullPath);
      }
    }
  }

  return Array.from(files).sort();
}

function normalizeEntries(json, sourceFile) {
  if (Array.isArray(json)) {
    return json.map((entry) => ({ ...entry, _sourceFile: sourceFile }));
  }
  if (json && Array.isArray(json.results)) {
    return json.results.map((entry) => ({ ...entry, _sourceFile: sourceFile }));
  }
  if (json && typeof json === "object") {
    return [{ ...json, _sourceFile: sourceFile }];
  }
  return [];
}

function isSuccessStatus(status) {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  return value === "" || value === "ok" || value === "success" || value === "passed";
}

function main() {
  const args = parseArgs(process.argv);
  const rulesFile = args["rules-file"];
  const resultsDir = args["results-dir"];
  const resultsFile = args["results-file"];
  const summaryFile = args["summary-file"];
  const allowFailures = Boolean(args["allow-failures"]);
  const dryRun = Boolean(args["dry-run"]);

  if (!rulesFile) fail("missing --rules-file");
  if (!resultsDir && !resultsFile) {
    fail("provide --results-dir and/or --results-file");
  }

  const files = listResultFiles({ resultsDir, resultsFile });
  if (files.length === 0) fail("no result files found");

  const byDomain = new Map();
  const skipped = [];

  for (const file of files) {
    const json = readJsonFile(file);
    const entries = normalizeEntries(json, file);
    for (const entry of entries) {
      const domain = normalizeDomain(entry.domain || entry.url);
      const css = typeof entry.css === "string" ? entry.css.trim() : "";
      const status = entry.status;

      if (!domain) {
        skipped.push({ file, reason: "missing domain/url" });
        continue;
      }
      if (!css) {
        skipped.push({ file, domain, reason: "missing css" });
        continue;
      }
      if (!allowFailures && !isSuccessStatus(status)) {
        skipped.push({ file, domain, reason: `status=${String(status)}` });
        continue;
      }

      byDomain.set(domain, { domain, css, file });
    }
  }

  if (byDomain.size === 0) {
    fail("no successful worker entries with domain+css were found");
  }

  const upsertScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "upsert_rule_entry.js");
  const selected = Array.from(byDomain.values()).sort((a, b) => a.domain.localeCompare(b.domain));

  for (const entry of selected) {
    if (dryRun) {
      console.log(`[dry-run] would upsert ${entry.domain} from ${entry.file}`);
      continue;
    }

    const proc = spawnSync(
      process.execPath,
      [upsertScript, "--rules-file", rulesFile, "--domain", entry.domain, "--css", entry.css],
      { stdio: "inherit" }
    );
    if (proc.status !== 0) {
      fail(`upsert failed for domain: ${entry.domain}`);
    }
  }

  const summary = {
    processed_files: files,
    applied_domains: selected.map((entry) => entry.domain),
    skipped,
    dry_run: dryRun,
  };

  if (summaryFile) {
    const fullPath = path.resolve(summaryFile);
    fs.writeFileSync(fullPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`wrote summary to ${fullPath}`);
  }

  console.log(
    `${dryRun ? "selected" : "applied"} ${selected.length} domain entr${
      selected.length === 1 ? "y" : "ies"
    } from ${files.length} worker result file${files.length === 1 ? "" : "s"}`
  );
}

main();
