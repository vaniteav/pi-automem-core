/**
 * project-detect.ts - Infer the current project from cwd, git remote, and prompt text.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AutoMemConfig } from "./config";

export interface ProjectDetection {
  projectTag: string | null;
  projectLabel: string | null;
}

function detectFromGit(cwd: string, gitRepoToTag: Record<string, string>): ProjectDetection {
  // Walk up the directory tree to handle running from a subdirectory of a repo
  let dir = cwd;
  while (true) {
    const gitConfigPath = resolve(dir, ".git", "config");
    if (existsSync(gitConfigPath)) {
      try {
        const gitConfig = readFileSync(gitConfigPath, "utf8");
        // Examine every remote url, not just the first — a repo's configured
        // tag may match a non-first remote (e.g. `upstream`).
        const remoteUrls = Array.from(gitConfig.matchAll(/^\s*url\s*=\s*(.+)$/gim))
          .map(function(m) { return m[1].trim().toLowerCase(); });
        const keys = Object.keys(gitRepoToTag);
        for (let u = 0; u < remoteUrls.length; u++) {
          for (let i = 0; i < keys.length; i++) {
            const substring = keys[i].toLowerCase();
            if (remoteUrls[u].indexOf(substring) !== -1) {
              const tag = gitRepoToTag[keys[i]];
              return { projectTag: tag, projectLabel: tag.replace(/^[^:]+:/, "") };
            }
          }
        }
      } catch (_e) {
        // ignore unreadable config
      }
      // Found .git but no matching remote — stop traversing
      break;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return { projectTag: null, projectLabel: null };
}

function detectFromFolder(cwd: string, folderTags: Record<string, string[]>): ProjectDetection {
  const normalizedFolderTags: Record<string, string[]> = {};
  const keys = Object.keys(folderTags);
  for (let i = 0; i < keys.length; i++) {
    normalizedFolderTags[keys[i].toLowerCase()] = folderTags[keys[i]];
  }

  const parts = cwd.split(/[\\/]/);
  for (let i = 0; i < parts.length; i++) {
    const lower = parts[i].toLowerCase();
    if (normalizedFolderTags[lower] && normalizedFolderTags[lower].length > 0) {
      const tag = normalizedFolderTags[lower][0];
      return { projectTag: tag, projectLabel: lower };
    }
  }
  return { projectTag: null, projectLabel: null };
}

function detectFromPrompt(prompt: string, gitRepoToTag: Record<string, string>): ProjectDetection {
  const lower = prompt.toLowerCase();
  const keys = Object.keys(gitRepoToTag);
  for (let i = 0; i < keys.length; i++) {
    if (lower.indexOf(keys[i].toLowerCase()) !== -1) {
      const tag = gitRepoToTag[keys[i]];
      return { projectTag: tag, projectLabel: tag.replace(/^[^:]+:/, "") };
    }
  }
  return { projectTag: null, projectLabel: null };
}

export function detectProject(
  cwd: string,
  prompt: string,
  config: AutoMemConfig,
): ProjectDetection {
  if (!config.projectDetection.enabled) {
    return { projectTag: null, projectLabel: null };
  }

  const gitResult = detectFromGit(cwd, config.projectDetection.gitRepoToTag);
  if (gitResult.projectTag) return gitResult;

  const folderResult = detectFromFolder(cwd, config.projectDetection.folderTags);
  if (folderResult.projectTag) return folderResult;

  return detectFromPrompt(prompt, config.projectDetection.gitRepoToTag);
}
