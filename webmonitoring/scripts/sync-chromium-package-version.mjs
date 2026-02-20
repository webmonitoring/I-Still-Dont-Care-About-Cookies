import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const manifestPath = path.join(repoRoot, "src", "manifest_v3.json");
const packagePath = path.join(repoRoot, "src", "package.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

if (typeof manifest.version !== "string" || manifest.version.length === 0) {
  throw new Error(`Invalid manifest version in ${manifestPath}`);
}

const oldVersion = pkg.version;
pkg.version = manifest.version;

if (oldVersion !== pkg.version) {
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    `Updated src/package.json version: ${oldVersion ?? "<none>"} -> ${pkg.version}`
  );
} else {
  console.log(`src/package.json version already up to date: ${pkg.version}`);
}
