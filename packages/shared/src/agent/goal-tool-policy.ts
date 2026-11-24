import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SESSION_TOOL_REGISTRY, type GoalToolRole } from '@craft-agent/session-tools-core';
import { GOAL_OWNER_TOOL_ACCESS } from '../goals/types.ts';
import { getPermissionMode } from './mode-manager.ts';
import { getSessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';

const PREFIX = 'mcp__session__';

export function getGoalToolRole(sessionId: string): GoalToolRole | undefined {
  const scope = getSessionScopedToolCallbacks(sessionId);
  return scope?.goals ? scope.goalRole : undefined;
}

/** Apply again at execution; provider tool lists can be stale during mode/role changes. */
export function goalToolDenial(sessionId: string, name: string, input?: unknown): string | undefined {
  const scope = getSessionScopedToolCallbacks(sessionId);
  const toolName = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
  const tool = SESSION_TOOL_REGISTRY.get(toolName);
  if (tool?.goalRoles) {
    const role = getGoalToolRole(sessionId);
    if (!role || !tool.goalRoles.includes(role)) return 'This goal tool is not assigned to this session.';
    if (tool.safeMode === 'block' && getPermissionMode(sessionId) === 'safe') return 'Goal changes are blocked in Explore mode.';
  } else if (scope?.goalReadFolders && !(scope.goalRole === 'owner' && GOAL_OWNER_TOOL_ACCESS === 'workspace-tools')
    && !allowedGoalInspection(scope.goalReadFolders, name, input)) {
    return 'Goal sessions only allow reading their own Goal and evidence files or calling assigned Goal tools. Use a separate chat for other work.';
  }
  return undefined;
}

/** No arbitrary same-user reads, writes, shell, sources, or child turns from assigned sessions. */
function allowedGoalInspection(folders: readonly string[], tool: string, args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const { file_path, path, pattern } = args as Record<string, unknown>;
  const name = tool.toLowerCase();
  if (path !== undefined && file_path !== undefined && path !== file_path) return false;
  const raw = name === 'read' ? file_path ?? path : path;
  if (typeof raw !== 'string' || !isAbsolute(raw)) return false;
  const target = resolve(raw);
  if (raw !== target) return false;
  try {
    if (realpathSync(target) !== target) return false;
    if (name === 'read') {
      const stat = lstatSync(target);
      return stat.isFile() && stat.nlink === 1 && folders.some(folder =>
        target === join(folder, 'GOAL.md') || dirname(target) === join(folder, 'evidence'));
    }
    // Simple listing of one already-confined evidence directory. No slash, parent or recursive glob.
    return (name === 'glob' || name === 'find') && typeof pattern === 'string' && /^[a-zA-Z0-9*?_.-]{1,128}$/.test(pattern)
      && !pattern.includes('..') && !pattern.includes('**') && folders.some(folder => target === join(folder, 'evidence'));
  } catch { return false; }
}
