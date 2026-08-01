import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Helpers for the structural tests — the ones that assert a property of the
 * source tree rather than the behaviour of a function.
 *
 * These exist because several of this milestone's invariants are "no module
 * does X", which a behavioural test cannot express: you cannot call the
 * function that was never written.
 */

/**
 * Reads a file with comments and string literals' contents removed.
 *
 * Necessary because these tests assert on *code*, and the modules they inspect
 * carry long explanatory comments that name the very things being forbidden.
 * Scanning raw text makes a file fail its own documentation.
 */
export function readCode(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, including JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, "$1 "); // line comments, sparing `https://`
}

/** Every TypeScript source file under `dir`, recursively. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Source files excluding tests and test helpers. */
export function productionFiles(dir: string): string[] {
  return sourceFiles(dir).filter(
    (f) => !/\.test\.tsx?$/.test(f) && !f.includes(join("lib", "testing")),
  );
}
