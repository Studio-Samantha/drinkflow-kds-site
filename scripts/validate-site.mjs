import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
const cssFiles = fs.readdirSync(root).filter((file) => file.endsWith(".css"));
const errors = [];
const idsByFile = new Map();

function localFileForUrl(fromFile, rawUrl) {
  const value = String(rawUrl || "").trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return null;
  }

  const withoutQuery = value.split("?")[0];
  const [pathname] = withoutQuery.split("#");
  if (!pathname || pathname.startsWith("/api/")) return null;

  if (pathname === "/") return path.join(root, "index.html");
  if (pathname.startsWith("/")) {
    const relativePath = pathname.slice(1);
    const exactPath = path.join(root, relativePath);
    if (path.extname(relativePath)) return exactPath;
    return path.join(root, `${relativePath}.html`);
  }

  return path.resolve(path.dirname(path.join(root, fromFile)), pathname);
}

function checkLocalReference(fromFile, rawUrl) {
  const target = localFileForUrl(fromFile, rawUrl);
  if (target && !fs.existsSync(target)) {
    errors.push(`${fromFile}: missing local target ${rawUrl}`);
  }
}

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  idsByFile.set(
    file,
    new Set([...source.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]))
  );

  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    checkLocalReference(file, match[1]);
  }

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] || "";
    if (/\bsrc=/i.test(attributes) || /application\/ld\+json/i.test(attributes)) continue;
    try {
      new Function(match[2]);
    } catch (error) {
      errors.push(`${file}: inline script does not parse (${error.message})`);
    }
  }

  if (
    /\bconst\s+PASSWORD\s*=/.test(source) ||
    /demo=training|goldieskds\.com\/api\//i.test(source)
  ) {
    errors.push(`${file}: contains a retired demo, API, or browser-password pattern`);
  }
}

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of source.matchAll(/\bhref=["']([^"']*#[^"']*)["']/gi)) {
    const value = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    const [pathname, hash] = value.split("#");
    if (!hash) continue;

    let targetFile = file;
    if (pathname) {
      const target = localFileForUrl(file, pathname);
      if (!target || !fs.existsSync(target) || !target.endsWith(".html")) continue;
      targetFile = path.basename(target);
    }

    if (!idsByFile.get(targetFile)?.has(hash)) {
      errors.push(`${file}: missing section target ${value}`);
    }
  }
}

for (const file of cssFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    checkLocalReference(file, match[1]);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML pages and ${cssFiles.length} stylesheets.`);
