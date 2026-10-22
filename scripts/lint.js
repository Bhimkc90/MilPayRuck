// Lightweight lint: syntax-checks every JavaScript file and compiles every EJS template.
// (The project has no ESLint/TypeScript configuration.)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

const root = path.join(__dirname, "..");
const skip = new Set(["node_modules", ".git", "data"]);
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|ejs)$/.test(entry.name)) files.push(full);
  }
};
walk(root);

let failed = 0;
for (const file of files) {
  try {
    if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    else ejs.compile(fs.readFileSync(file, "utf8"), { filename: file });
  } catch (error) {
    failed += 1;
    console.error(`✗ ${path.relative(root, file)}\n${String(error.stderr || error.message).trim()}`);
  }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
