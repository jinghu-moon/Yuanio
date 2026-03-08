import { existsSync } from "node:fs";
import { basename } from "node:path";

const PROJECTS_FILE = `${process.env.HOME || process.env.USERPROFILE}/.yuanio/projects.json`;

export interface ProjectEntry {
  name: string;
  path: string;
  addedAt: number;
  lastUsed?: number;
}

/** 加载项目列表 */
export function loadProjectList(): ProjectEntry[] {
  try {
    if (!existsSync(PROJECTS_FILE)) return [];
    const raw = require("fs").readFileSync(PROJECTS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** 保存项目列表 */
export function saveProjectList(projects: ProjectEntry[]): void {
  const dir = PROJECTS_FILE.replace(/\/[^/]+$/, "");
  require("fs").mkdirSync(dir, { recursive: true });
  require("fs").writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

/** 添加项目 */
export function addProject(path: string, name?: string): ProjectEntry {
  const projects = loadProjectList();
  const existing = projects.find((p) => p.path === path);
  if (existing) {
    existing.lastUsed = Date.now();
    saveProjectList(projects);
    return existing;
  }
  const entry: ProjectEntry = {
    name: name || basename(path),
    path,
    addedAt: Date.now(),
    lastUsed: Date.now(),
  };
  projects.push(entry);
  saveProjectList(projects);
  return entry;
}

/** 移除项目 */
export function removeProject(path: string): boolean {
  const projects = loadProjectList();
  const idx = projects.findIndex((p) => p.path === path);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  saveProjectList(projects);
  return true;
}
