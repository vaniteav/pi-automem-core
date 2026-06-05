/**
 * context-injector.ts - Build the context message injected into the session
 * from recall results.
 */

import type { RecallResult } from "./recall";
import type { ProjectDetection } from "./project-detect";

export interface Injection {
  message: string;
  projectTag: string | null;
}

export function buildContextMessage(
  startupResult: RecallResult,
  turnResult: RecallResult,
  project: ProjectDetection,
): Injection | null {
  const sections: string[] = [];

  if (startupResult.text) {
    sections.push(
      "## AutoMem Startup Recall (" + startupResult.count + " memories)\n" + startupResult.text
    );
  }

  if (turnResult.text) {
    const projectLabel = project.projectLabel ? " [" + project.projectLabel + "]" : "";
    sections.push(
      "## AutoMem Turn Recall" + projectLabel + " (" + turnResult.count + " memories)\n" + turnResult.text
    );
  }

  if (sections.length === 0) {
    return null;
  }

  return {
    message: sections.join("\n\n"),
    projectTag: project.projectTag,
  };
}
