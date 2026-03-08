import React from "react";
import { Box, Text } from "ink";
import type { LauncherI18n } from "../i18n/index.ts";

export type TabId = "dashboard" | "services" | "pair" | "monitor" | "logs" | "skills" | "config";

const TABS: { id: TabId; labelKey: string; key: string }[] = [
  { id: "dashboard", labelKey: "tab.dashboard", key: "1" },
  { id: "services", labelKey: "tab.services", key: "2" },
  { id: "pair", labelKey: "tab.pair", key: "3" },
  { id: "monitor", labelKey: "tab.monitor", key: "4" },
  { id: "logs", labelKey: "tab.logs", key: "5" },
  { id: "skills", labelKey: "tab.skills", key: "6" },
  { id: "config", labelKey: "tab.config", key: "7" },
];

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  i18n: LauncherI18n;
}

export function TabBar({ active, i18n }: TabBarProps) {
  return (
    <Box paddingX={1}>
      {TABS.map((tab, i) => (
        <React.Fragment key={tab.id}>
          {i > 0 && <Text> │ </Text>}
          <Text
            bold={active === tab.id}
            color={active === tab.id ? "cyan" : "gray"}
          >
            {tab.key}:{i18n.t(tab.labelKey)}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
