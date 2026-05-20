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
  if (json && Array.isArray(json.per_url_results)) {
    return json.per_url_results.map((entry) => ({
      ...entry,
      domain: entry.domain || json.domain,
      url: entry.url || entry.target_url || json.url,
      css: entry.css || json.css,
      status: entry.status || json.status,
      verification: entry.verification || entry.qa || json.verification || json.qa || null,
      _sourceFile: sourceFile,
    }));
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

function isBlockedStatus(status) {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  return (
    value === "blocked_by_security" ||
    value === "blocked" ||
    value === "security_blocked" ||
    value === "challenge" ||
    value === "security_challenge" ||
    value === "bot_challenge" ||
    value === "captcha"
  );
}

function getPath(obj, pathValue) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = pathValue.split(".");
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function firstBoolean(obj, paths) {
  for (const pathValue of paths) {
    const value = getPath(obj, pathValue);
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function firstNumber(obj, paths) {
  for (const pathValue of paths) {
    const value = getPath(obj, pathValue);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function getVerification(entry) {
  return entry.verification || entry.qa || null;
}

function evaluateVerification(entry, { allowUnverified }) {
  const verification = getVerification(entry);
  if (!verification) {
    return allowUnverified
      ? { ok: true, reason: "missing_verification_allowed" }
      : { ok: false, reason: "missing_verification" };
  }

  const qaPassed = firstBoolean(verification, ["passed", "qa_passed", "checks_passed", "result.ok"]);
  if (qaPassed === false) return { ok: false, reason: "verification_failed" };

  const afterPopupDetected = firstBoolean(verification, [
    "after_popup_detected",
    "after.popup_detected",
    "after.has_popup",
    "after.has_dialog",
    "after.has_overlay",
    "result.after_popup_detected",
  ]);
  if (afterPopupDetected === true) return { ok: false, reason: "after_popup_detected" };

  const afterPopupCount = firstNumber(verification, [
    "after_popup_count",
    "remaining_popup_count",
    "after.remaining_popup_count",
    "after.overlay_candidates",
    "after.dialog_count",
    "result.after_popup_count",
  ]);
  if (afterPopupCount !== undefined && afterPopupCount > 0) {
    return { ok: false, reason: "after_popup_count_gt_zero" };
  }

  const afterBlurDetected = firstBoolean(verification, [
    "after_backdrop_blur",
    "after.backdrop_blur",
    "after.has_blur_backdrop",
    "after.has_dim_backdrop",
    "result.after_backdrop_blur",
  ]);
  if (afterBlurDetected === true) return { ok: false, reason: "after_backdrop_blur_detected" };

  return { ok: true, reason: "verified" };
}

function uniq(values) {
  return Array.from(new Set(values));
}

function combineCss(cssValues) {
  const uniqueCss = uniq(
    cssValues
      .map((css) => (typeof css === "string" ? css.trim() : ""))
      .filter(Boolean)
  );
  if (uniqueCss.length === 0) return "";
  if (uniqueCss.length === 1) return uniqueCss[0];
  return uniqueCss.join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const rulesFile = args["rules-file"];
  const resultsDir = args["results-dir"];
  const resultsFile = args["results-file"];
  const summaryFile = args["summary-file"];
  const allowFailures = Boolean(args["allow-failures"]);
  const allowNoop = Boolean(args["allow-noop"]);
  const allowUnverified = Boolean(args["allow-unverified"]);
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
      const url = typeof entry.url === "string" ? entry.url : "";
      const verification = getVerification(entry);

      if (!domain) {
        skipped.push({ file, reason: "missing domain/url" });
        continue;
      }

      const bucket = byDomain.get(domain) || { domain, entries: [] };
      bucket.entries.push({
        domain,
        css,
        status,
        url,
        verification,
        file,
      });
      byDomain.set(domain, bucket);
    }
  }

  const selected = [];
  const domainDetails = [];
  const domains = Array.from(byDomain.keys()).sort();

  for (const domain of domains) {
    const bucket = byDomain.get(domain);
    const entries = bucket.entries;
    const blockedEntries = entries.filter((entry) => isBlockedStatus(entry.status));
    const actionableEntries = entries.filter((entry) => !isBlockedStatus(entry.status));
    const testedUrls = uniq(entries.map((entry) => entry.url).filter(Boolean));

    if (actionableEntries.length === 0) {
      skipped.push({
        domain,
        files: uniq(entries.map((entry) => entry.file)).sort(),
        reason: "all_urls_blocked_or_challenged",
        blocked_statuses: uniq(blockedEntries.map((entry) => String(entry.status || ""))).sort(),
      });
      continue;
    }

    const failedActionable = actionableEntries.filter((entry) => !isSuccessStatus(entry.status));
    if (!allowFailures && failedActionable.length > 0) {
      skipped.push({
        domain,
        files: uniq(entries.map((entry) => entry.file)).sort(),
        reason: "actionable_url_failed_status",
        statuses: uniq(failedActionable.map((entry) => String(entry.status || ""))).sort(),
      });
      continue;
    }

    const verificationEvaluations = actionableEntries.map((entry) => ({
      entry,
      evaluation: evaluateVerification(entry, { allowUnverified }),
    }));
    const failedVerification = verificationEvaluations.filter((item) => !item.evaluation.ok);
    if (failedVerification.length > 0) {
      skipped.push({
        domain,
        files: uniq(entries.map((entry) => entry.file)).sort(),
        reason: "actionable_url_failed_verification",
        verification_reasons: uniq(failedVerification.map((item) => item.evaluation.reason)).sort(),
        allow_unverified: allowUnverified,
      });
      continue;
    }

    let cssCandidates = actionableEntries
      .map((entry) => ({ ...entry, css: entry.css.trim() }))
      .filter((entry) => entry.css.length > 0);

    if (!allowNoop) {
      cssCandidates = cssCandidates.filter((entry) => !entry.css.includes(".__codex_noop__"));
    }

    if (cssCandidates.length === 0) {
      skipped.push({
        domain,
        files: uniq(entries.map((entry) => entry.file)).sort(),
        reason: allowNoop ? "missing css" : "missing_or_noop_css",
      });
      continue;
    }

    const combinedCss = combineCss(cssCandidates.map((entry) => entry.css));
    if (!combinedCss) {
      skipped.push({
        domain,
        files: uniq(entries.map((entry) => entry.file)).sort(),
        reason: "empty_combined_css",
      });
      continue;
    }

    selected.push({
      domain,
      css: combinedCss,
      files: uniq(cssCandidates.map((entry) => entry.file)).sort(),
    });

    domainDetails.push({
      domain,
      tested_urls: testedUrls,
      actionable_entries: actionableEntries.length,
      blocked_entries: blockedEntries.length,
      verified_entries: verificationEvaluations.filter((item) => item.evaluation.ok).length,
      css_variants: uniq(cssCandidates.map((entry) => entry.css)).length,
      source_files: uniq(entries.map((entry) => entry.file)).sort(),
    });
  }

  if (selected.length === 0) {
    const topReasons = uniq(skipped.map((item) => item.reason).filter(Boolean)).sort();
    fail(
      `no successful worker entries with domain+css were found (skip reasons: ${
        topReasons.length > 0 ? topReasons.join(", ") : "none recorded"
      }). If this run intentionally omits verification metadata, use --allow-unverified.`
    );
  }

  const upsertScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "upsert_rule_entry.js");

  for (const entry of selected) {
    if (dryRun) {
      console.log(`[dry-run] would upsert ${entry.domain} from ${entry.files.join(", ")}`);
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
    domain_details: domainDetails,
    skipped,
    dry_run: dryRun,
    allow_unverified: allowUnverified,
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
