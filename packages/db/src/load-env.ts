import fs from "node:fs";
import path from "node:path";

/**
 * Loads the nearest .env file (looking up from the current folder to the repo root).
 * Values already set in the environment win, so production can set variables directly instead.
 */
export function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/.exec(line);
        if (!m || line.trim().startsWith("#")) continue;
        let v = (m[2] ?? "").replace(/\s+#.*$/, "").trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
      return file;
    }
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
