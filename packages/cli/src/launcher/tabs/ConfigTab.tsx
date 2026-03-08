import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { normalizeNamespace } from "@yuanio/shared";
import { loadConfig, saveConfig, type LauncherConfig } from "../config.ts";
import { createI18n, normalizeLocale, type LauncherI18n } from "../i18n/index.ts";

type FieldType = "text" | "number" | "bool" | "enum";

interface FieldDef {
  key: keyof LauncherConfig;
  labelKey: string;
  type: FieldType;
  options?: string[];
}

const FIELDS: FieldDef[] = [
  { key: "serverUrl", labelKey: "config.field.server_url", type: "text" },
  { key: "namespace", labelKey: "config.field.namespace", type: "text" },
  { key: "relayPort", labelKey: "config.field.relay_port", type: "number" },
  { key: "autoStart", labelKey: "config.field.auto_start", type: "bool" },
  { key: "connectionProfile", labelKey: "config.field.connection_profile", type: "enum", options: ["lan", "tunnel"] },
  { key: "tunnelMode", labelKey: "config.field.tunnel_mode", type: "enum", options: ["named", "quick"] },
  { key: "tunnelName", labelKey: "config.field.tunnel_name", type: "text" },
  { key: "tunnelHostname", labelKey: "config.field.tunnel_host", type: "text" },
  { key: "language", labelKey: "config.field.language", type: "enum", options: ["zh-CN", "zh-TW", "en"] },
];

interface ConfigTabProps {
  config: LauncherConfig;
  i18n: LauncherI18n;
  onApply: (next: LauncherConfig) => void;
  onEditStateChange?: (editing: boolean) => void;
}

const LABEL_COLUMN_WIDTH = 18;

type LanguageSelectItem = {
  label: string;
  value: LauncherConfig["language"];
};

function normalizeDraft(draft: LauncherConfig): LauncherConfig {
  const relayPort = Number.isFinite(Number(draft.relayPort)) ? Number(draft.relayPort) : 3000;
  const safePort = Math.max(1, Math.min(65535, relayPort));
  const tunnelMode = draft.tunnelMode === "quick" ? "quick" : "named";
  const connectionProfile = draft.connectionProfile === "lan" ? "lan" : "tunnel";
  return {
    ...draft,
    serverUrl: draft.serverUrl.trim() || "http://localhost:3000",
    namespace: normalizeNamespace(draft.namespace),
    relayPort: safePort,
    autoStart: Boolean(draft.autoStart),
    connectionProfile,
    tunnelMode,
    tunnelName: draft.tunnelName.trim(),
    tunnelHostname: draft.tunnelHostname.trim(),
    language: normalizeLocale(draft.language),
  };
}

function toDisplay(field: FieldDef, value: unknown, i18n: LauncherI18n): string {
  if (field.key === "language") return i18n.t(`config.lang.${String(value ?? "en")}`);
  if (field.key === "connectionProfile") return i18n.t(`config.connection.${String(value ?? "tunnel")}`);
  if (typeof value === "boolean") return value ? i18n.t("common.true") : i18n.t("common.false");
  return String(value ?? i18n.t("common.none"));
}

export function ConfigTab({ config, i18n, onApply, onEditStateChange }: ConfigTabProps) {
  const [draft, setDraft] = useState<LauncherConfig>(config);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selectingLanguage, setSelectingLanguage] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    onEditStateChange?.(editing || selectingLanguage);
    return () => onEditStateChange?.(false);
  }, [editing, onEditStateChange, selectingLanguage]);

  const dirty = useMemo(
    () => JSON.stringify(normalizeDraft(draft)) !== JSON.stringify(normalizeDraft(config)),
    [config, draft],
  );

  const selected = FIELDS[cursor];
  const languageItems: LanguageSelectItem[] = useMemo(
    () => [
      { label: i18n.t("config.lang.zh-CN"), value: "zh-CN" },
      { label: i18n.t("config.lang.zh-TW"), value: "zh-TW" },
      { label: i18n.t("config.lang.en"), value: "en" },
    ],
    [i18n],
  );
  const languageInitialIndex = Math.max(
    0,
    languageItems.findIndex((item) => item.value === draft.language),
  );

  const startEdit = () => {
    const current = draft[selected.key];
    if (selected.key === "language") {
      setSelectingLanguage(true);
      return;
    }
    if (selected.type === "bool") {
      setDraft((prev) => ({ ...prev, [selected.key]: !Boolean(current) }));
      return;
    }
    if (selected.type === "enum") {
      const options = selected.options || [];
      const idx = Math.max(0, options.indexOf(String(current)));
      const next = options[(idx + 1) % options.length] || options[0] || String(current);
      setDraft((prev) => ({ ...prev, [selected.key]: next as LauncherConfig[typeof selected.key] }));
      return;
    }
    setBuffer(String(current ?? ""));
    setEditing(true);
  };

  const commitEdit = () => {
    if (selected.type === "number") {
      const n = Number(buffer.trim());
      if (!Number.isFinite(n) || n < 1 || n > 65535) {
        setMessage(i18n.t("config.error.relay_port_range"));
        return;
      }
      setDraft((prev) => ({ ...prev, [selected.key]: n }));
    } else {
      const value = selected.key === "namespace" ? normalizeNamespace(buffer) : buffer;
      setDraft((prev) => ({ ...prev, [selected.key]: value as LauncherConfig[typeof selected.key] }));
    }
    setEditing(false);
    setBuffer("");
    setMessage("");
  };

  const saveToDisk = () => {
    const next = normalizeDraft(draft);
    saveConfig(next);
    onApply(next);
    setDraft(next);
    setMessage(createI18n(next.language).t("config.message.saved"));
  };

  const reloadFromDisk = () => {
    const loaded = loadConfig();
    setDraft(loaded);
    setMessage(createI18n(loaded.language).t("config.message.reloaded"));
    setEditing(false);
    setBuffer("");
  };

  useInput((input, key) => {
    if (selectingLanguage) {
      if (key.escape) {
        setSelectingLanguage(false);
        setMessage(i18n.t("config.message.edit_cancelled"));
      }
      return;
    }

    if (editing) {
      if (key.escape) {
        setEditing(false);
        setBuffer("");
        setMessage(i18n.t("config.message.edit_cancelled"));
        return;
      }
      if (key.return) {
        commitEdit();
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer((prev) => prev.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && !key.tab && input) {
        setBuffer((prev) => prev + input);
      }
      return;
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(FIELDS.length - 1, c + 1));
    if (key.return || input === "e") startEdit();
    if (input === "s") saveToDisk();
    if (input === "l") reloadFromDisk();
    if (input === "d") {
      setDraft(config);
      setMessage(i18n.t("config.message.discarded"));
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>{i18n.t("config.title")}</Text>
      <Box flexDirection="column" marginLeft={1}>
        {FIELDS.map((field, idx) => {
          const active = idx === cursor;
          const label = i18n.t(field.labelKey);
          const value = toDisplay(field, draft[field.key], i18n);
          return (
            <Box key={field.key} gap={1}>
              <Text color={active ? "cyan" : "white"}>{active ? ">" : " "}</Text>
              <Box width={LABEL_COLUMN_WIDTH}>
                <Text bold={active}>{label}</Text>
              </Box>
              <Text color={active ? "cyan" : "white"} wrap="truncate">{value}</Text>
            </Box>
          );
        })}
      </Box>

      {editing ? (
        <Box flexDirection="column">
          <Text color="yellow">{i18n.t("config.editing", { field: i18n.t(selected.labelKey) })}</Text>
          <Text>{buffer || " "}</Text>
        </Box>
      ) : selectingLanguage ? (
        <Box flexDirection="column" gap={1}>
          <Text color="yellow">{i18n.t("config.selecting", { field: i18n.t("config.field.language") })}</Text>
          <Box marginLeft={1}>
            <SelectInput
              items={languageItems}
              initialIndex={languageInitialIndex}
              onSelect={(item) => {
                setDraft((prev) => ({ ...prev, language: item.value }));
                setSelectingLanguage(false);
                setMessage("");
              }}
            />
          </Box>
        </Box>
      ) : (
        <Text dimColor>{i18n.t("config.shortcuts")}</Text>
      )}

      <Text color={dirty ? "yellow" : "gray"}>{dirty ? i18n.t("config.state.dirty") : i18n.t("config.state.synced")}</Text>
      {message ? <Text color="green">{message}</Text> : null}
      <Text dimColor>{i18n.t("config.note.restart")}</Text>
    </Box>
  );
}
