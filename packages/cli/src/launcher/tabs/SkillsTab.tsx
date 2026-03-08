import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { LauncherI18n } from "../i18n/index.ts";
import { createUniqueRenderKeys } from "../render-keys.ts";

interface SkillsTabProps {
  daemonPort?: number;
  i18n: LauncherI18n;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  scope: string;
  source: string;
  path: string;
}

interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  path: string;
  valid: boolean;
  warnings: string[];
}

interface SkillLogItem {
  id: string;
  at: number;
  level: string;
  action: string;
  message: string;
}

function statusLine(text: string, error = false): { text: string; error: boolean } {
  return { text, error };
}

export function SkillsTab({ daemonPort, i18n }: SkillsTabProps) {
  const [source, setSource] = useState("./refer/teleclaude");
  const [scope, setScope] = useState<"project" | "user">("project");
  const [installId, setInstallId] = useState("");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [logs, setLogs] = useState<SkillLogItem[]>([]);
  const [candidateCursor, setCandidateCursor] = useState(0);
  const [editingSource, setEditingSource] = useState(false);
  const [sourceBuffer, setSourceBuffer] = useState(source);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(() => statusLine("ready"));

  const baseUrl = useMemo(() => daemonPort ? `http://localhost:${daemonPort}` : null, [daemonPort]);
  const candidateKeys = useMemo(
    () => createUniqueRenderKeys(candidates, (item) => item.id || item.path || item.name, "skill-candidate"),
    [candidates],
  );
  const skillKeys = useMemo(
    () => createUniqueRenderKeys(skills, (item) => item.id || item.path || item.name, "skill-installed"),
    [skills],
  );
  const logKeys = useMemo(
    () => createUniqueRenderKeys(logs, (item) => item.id || `${item.at}:${item.action}:${item.message}`, "skill-log"),
    [logs],
  );

  const daemonFetch = useCallback(async (path: string, init?: RequestInit) => {
    if (!baseUrl) throw new Error("daemon not running");
    const reqInit: RequestInit = {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    };
    const res = await fetch(`${baseUrl}${path}`, reqInit);
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [baseUrl]);

  const loadSkills = useCallback(async () => {
    const data = await daemonFetch(`/skills/list>scope=${encodeURIComponent(scope)}`);
    const items = Array.isArray(data.items) ? data.items : [];
    setSkills(items.map((item: any) => ({
      id: String(item.id || ""),
      name: String(item.name || "unknown"),
      description: String(item.description || ""),
      scope: String(item.scope || "project"),
      source: String(item.source || ""),
      path: String(item.path || ""),
    })));
  }, [daemonFetch, scope]);

  const loadLogs = useCallback(async () => {
    const data = await daemonFetch("/skills/logs>limit=20");
    const items = Array.isArray(data.items) ? data.items : [];
    setLogs(items.map((item: any) => ({
      id: String(item.id || ""),
      at: Number(item.at || Date.now()),
      level: String(item.level || "info"),
      action: String(item.action || ""),
      message: String(item.message || ""),
    })));
  }, [daemonFetch]);

  const loadInstallStatus = useCallback(async () => {
    if (!installId) return;
    const data = await daemonFetch(`/skills/install/status/${encodeURIComponent(installId)}`);
    const items = Array.isArray(data.candidates) ? data.candidates : [];
    const mapped: SkillCandidate[] = items.map((item: any) => ({
      id: String(item.id || ""),
      name: String(item.name || "unknown"),
      description: String(item.description || ""),
      path: String(item.path || ""),
      valid: item.valid !== false,
      warnings: Array.isArray(item.warnings) ? item.warnings.map((w: any) => String(w)) : [],
    }));
    setCandidates(mapped);
    setSelected((prev) => {
      const prevSet = new Set(prev);
      for (const item of mapped) {
        if (item.valid && !prevSet.has(item.id)) prevSet.add(item.id);
      }
      return Array.from(prevSet).filter((id: string) => mapped.some((item: SkillCandidate) => item.id === id));
    });
  }, [daemonFetch, installId]);

  const refreshAll = useCallback(async () => {
    if (!baseUrl) return;
    setBusy(true);
    try {
      await Promise.all([loadSkills(), loadLogs(), loadInstallStatus()]);
      setStatus(statusLine("refreshed"));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(statusLine(msg, true));
    } finally {
      setBusy(false);
    }
  }, [baseUrl, loadInstallStatus, loadLogs, loadSkills]);

  useEffect(() => {
    if (!baseUrl) return;
    void refreshAll();
  }, [baseUrl, refreshAll]);

  const prepareInstall = useCallback(async () => {
    if (!source.trim()) {
      setStatus(statusLine("source required", true));
      return;
    }
    setBusy(true);
    try {
      const data = await daemonFetch("/skills/install/prepare", {
        method: "POST",
        body: JSON.stringify({ source: source.trim(), scope }),
      });
      const id = String(data.installId || "");
      setInstallId(id);
      const items = Array.isArray(data.candidates) ? data.candidates : [];
      const mapped: SkillCandidate[] = items.map((item: any) => ({
        id: String(item.id || ""),
        name: String(item.name || "unknown"),
        description: String(item.description || ""),
        path: String(item.path || ""),
        valid: item.valid !== false,
        warnings: Array.isArray(item.warnings) ? item.warnings.map((w: any) => String(w)) : [],
      }));
      setCandidates(mapped);
      setSelected(mapped.filter((item) => item.valid).map((item) => item.id));
      setCandidateCursor(0);
      await loadLogs();
      setStatus(statusLine(`prepared ${id} (${mapped.length})`));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(statusLine(msg, true));
    } finally {
      setBusy(false);
    }
  }, [daemonFetch, loadLogs, scope, source]);

  const commitInstall = useCallback(async (policy: "skip" | "overwrite" | "rename") => {
    if (!installId) {
      setStatus(statusLine("installId required", true));
      return;
    }
    if (selected.length === 0) {
      setStatus(statusLine("no candidate selected", true));
      return;
    }
    setBusy(true);
    try {
      const data = await daemonFetch("/skills/install/commit", {
        method: "POST",
        body: JSON.stringify({
          installId,
          selected,
          conflictPolicy: policy,
        }),
      });
      const installed = Array.isArray(data.installed) ? data.installed.length : 0;
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      const failed = Array.isArray(data.failed) ? data.failed.length : 0;
      await Promise.all([loadSkills(), loadLogs(), loadInstallStatus()]);
      setStatus(statusLine(`commit ok total=${data.total ?? 0} i=${installed} s=${skipped} f=${failed}`));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(statusLine(msg, true));
    } finally {
      setBusy(false);
    }
  }, [daemonFetch, installId, loadInstallStatus, loadLogs, loadSkills, selected]);

  const cancelInstall = useCallback(async () => {
    if (!installId) {
      setStatus(statusLine("installId required", true));
      return;
    }
    setBusy(true);
    try {
      await daemonFetch("/skills/install/cancel", {
        method: "POST",
        body: JSON.stringify({ installId }),
      });
      setCandidates([]);
      setSelected([]);
      setInstallId("");
      await loadLogs();
      setStatus(statusLine("install cancelled"));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(statusLine(msg, true));
    } finally {
      setBusy(false);
    }
  }, [daemonFetch, installId, loadLogs]);

  useInput((input, key) => {
    if (editingSource) {
      if (key.escape) {
        setEditingSource(false);
        setSourceBuffer(source);
        return;
      }
      if (key.return) {
        setSource(sourceBuffer);
        setEditingSource(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSourceBuffer((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && !key.tab && input) {
        setSourceBuffer((prev) => prev + input);
      }
      return;
    }

    if (key.upArrow) {
      setCandidateCursor((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setCandidateCursor((prev) => Math.min(Math.max(0, candidates.length - 1), prev + 1));
      return;
    }

    if (input === "e") {
      setEditingSource(true);
      setSourceBuffer(source);
      return;
    }
    if (input === "g") {
      setScope((prev) => prev === "project" ? "user" : "project");
      return;
    }
    if (input === "r") {
      void refreshAll();
      return;
    }
    if (input === "p") {
      void prepareInstall();
      return;
    }
    if (input === "s") {
      void loadInstallStatus();
      return;
    }
    if (input === "a") {
      setSelected(candidates.filter((item) => item.valid).map((item) => item.id));
      return;
    }
    if (input === "x") {
      void cancelInstall();
      return;
    }
    if (input === "c") {
      void commitInstall("skip");
      return;
    }
    if (input === "o") {
      void commitInstall("overwrite");
      return;
    }
    if (input === " " && candidates.length > 0) {
      const current = candidates[candidateCursor];
      if (!current || !current.valid) return;
      setSelected((prev) => {
        const set = new Set(prev);
        if (set.has(current.id)) set.delete(current.id);
        else set.add(current.id);
        return Array.from(set);
      });
    }
  });

  if (!daemonPort) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold underline>{i18n.t("skills.title")}</Text>
        <Text color="yellow">{i18n.t("skills.daemon_required")}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between">
        <Text bold underline>{i18n.t("skills.title")}</Text>
        <Text dimColor>{i18n.t("skills.hotkeys")}</Text>
      </Box>

      <Box gap={2}>
        <Text>{i18n.t("skills.source")}: {editingSource ? sourceBuffer : source}</Text>
      </Box>
      <Box gap={2}>
        <Text>{i18n.t("skills.scope")}: {scope}</Text>
        <Text>{i18n.t("skills.install_id")}: {installId || "(none)"}</Text>
      </Box>
      <Text color={status.error ? "red" : "gray"}>
        {busy ? i18n.t("skills.loading") : status.text}
      </Text>

      <Box gap={2}>
        <Box flexDirection="column" width="56%">
          <Text bold>{i18n.t("skills.candidates", { count: candidates.length })}</Text>
          {candidates.length === 0 ? (
            <Text dimColor>{i18n.t("skills.no_candidates")}</Text>
          ) : (
            <Box flexDirection="column">
              {candidates.slice(0, 12).map((item, idx) => {
                const selectedMark = selected.includes(item.id) ? "[x]" : "[ ]";
                const cursor = idx === candidateCursor ? ">" : " ";
                const validity = item.valid ? "" : " (invalid)";
                return (
                  <Text key={candidateKeys[idx]} color={idx === candidateCursor ? "cyan" : "white"} wrap="truncate">
                    {cursor} {selectedMark} {item.name}{validity} - {item.description}
                  </Text>
                );
              })}
            </Box>
          )}
        </Box>

        <Box flexDirection="column" width="44%">
          <Text bold>{i18n.t("skills.installed", { count: skills.length })}</Text>
          {skills.length === 0 ? (
            <Text dimColor>{i18n.t("skills.no_installed")}</Text>
          ) : (
            skills.slice(0, 8).map((item, idx) => (
              <Text key={skillKeys[idx]} wrap="truncate">
                {item.name} ({item.scope}/{item.source})
              </Text>
            ))
          )}
          <Text bold>{i18n.t("skills.logs", { count: logs.length })}</Text>
          {logs.length === 0 ? (
            <Text dimColor>{i18n.t("skills.no_logs")}</Text>
          ) : (
            logs.slice(0, 6).map((log, idx) => (
              <Text key={logKeys[idx]} dimColor wrap="truncate">
                [{log.level}] {log.action}: {log.message}
              </Text>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
