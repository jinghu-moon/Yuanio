import {
  getMemoryCenterStatus,
  setAutoMemoryEnabled,
  appendAutoMemoryNote,
} from "./memory-center";
import {
  listAgentSpecs,
  deleteAgentSpec,
} from "./agent-config";
import { saveAgentFromRecord } from "./agent-record";
import {
  getPermissionRules,
  setPermissionRules,
  getSandboxPolicy,
  setSandboxPolicy,
  type PermissionRuleSet,
  type SandboxPolicy,
} from "./permission-policy";
import {
  listOutputStyles,
  getCurrentOutputStyle,
  setCurrentOutputStyleId,
} from "./output-style";
import type { RpcDepsFactoryContext } from "./rpc-deps-factory";

export function createMemoryRpcProviders(getCwd: () => string): Pick<
  RpcDepsFactoryContext,
  "getMemoryStatus" | "setMemoryEnabled" | "addMemoryNote"
> {
  return {
    getMemoryStatus: () => getMemoryCenterStatus(getCwd()),
    setMemoryEnabled: (enabled) => {
      const saved = setAutoMemoryEnabled(enabled, getCwd());
      return {
        enabled: saved,
        status: getMemoryCenterStatus(getCwd()),
      };
    },
    addMemoryNote: (note, topic) => appendAutoMemoryNote(note, { topic, cwd: getCwd() }),
  };
}

export function createAgentRpcProviders(getCwd: () => string): Pick<
  RpcDepsFactoryContext,
  "listAgents" | "saveAgent" | "deleteAgent"
> {
  return {
    listAgents: () => listAgentSpecs(getCwd()),
    saveAgent: (agent) => saveAgentFromRecord(agent, getCwd()),
    deleteAgent: (name) => deleteAgentSpec(name, getCwd()),
  };
}

export function createPolicyRpcProviders(
  getCwd: () => string,
  getPermissionRulesRef: () => PermissionRuleSet,
  setPermissionRulesRef: (next: PermissionRuleSet) => void,
  getSandboxPolicyRef: () => SandboxPolicy,
  setSandboxPolicyRef: (next: SandboxPolicy) => void,
): Pick<RpcDepsFactoryContext, "getPermissionRules" | "setPermissionRules" | "getSandboxPolicy" | "setSandboxPolicy"> {
  return {
    getPermissionRules: () => getPermissionRulesRef(),
    setPermissionRules: (rules) => {
      const next = setPermissionRules(rules, getCwd());
      setPermissionRulesRef(next);
      return next;
    },
    getSandboxPolicy: () => getSandboxPolicyRef(),
    setSandboxPolicy: (policy) => {
      const next = setSandboxPolicy(policy, getCwd());
      setSandboxPolicyRef(next);
      return next;
    },
  };
}

export function createOutputStyleRpcProviders(getCwd: () => string): Pick<
  RpcDepsFactoryContext,
  "listOutputStyles" | "getOutputStyle" | "setOutputStyle"
> {
  return {
    listOutputStyles: () => listOutputStyles(getCwd()),
    getOutputStyle: () => getCurrentOutputStyle(getCwd()),
    setOutputStyle: (styleId) => {
      const saved = setCurrentOutputStyleId(styleId, getCwd());
      return {
        styleId: saved,
        style: getCurrentOutputStyle(getCwd()),
      };
    },
  };
}

export function createProjectScopeConfigProvider(
  getCwd: () => string,
  setPermissionRulesRef: (next: PermissionRuleSet) => void,
  setSandboxPolicyRef: (next: SandboxPolicy) => void,
  reloadHooks: () => void,
): () => void {
  return () => {
    setPermissionRulesRef(getPermissionRules(getCwd()));
    setSandboxPolicyRef(getSandboxPolicy(getCwd()));
    reloadHooks();
  };
}
