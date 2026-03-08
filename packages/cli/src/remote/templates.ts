const TEMPLATES_DIR = ".yuanio";
const TEMPLATES_FILE = `${TEMPLATES_DIR}/templates.json`;

export function loadTemplates(): Record<string, string> {
  try {
    const fs = require("node:fs");
    if (!fs.existsSync(TEMPLATES_FILE)) return {};
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveTemplate(name: string, content: string): void {
  const fs = require("node:fs");
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  const templates = loadTemplates();
  templates[name] = content;
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

export function deleteTemplate(name: string): void {
  const fs = require("node:fs");
  const templates = loadTemplates();
  delete templates[name];
  if (fs.existsSync(TEMPLATES_FILE)) {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  }
}
