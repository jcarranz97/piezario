import { Alert } from "@heroui/react";

import type { ThreeMfReport } from "@/lib/threemf";

/** "1, 2 and 3" */
function list(values: Array<number | string>): string {
  const parts = values.map(String);
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Reports what comparing a model's `.3mf` files found.
 *
 * Shows the clean result as well as the bad one. A page with no warning is
 * indistinguishable from a page where nothing was ever checked, and the
 * question this answers — "are these variants safe to open together?" — is
 * only answered by saying so out loud.
 */
export function ExtruderCheck({ report }: { report: ThreeMfReport }) {
  // Nothing to compare: fewer than two readable 3MFs, or no shared tools.
  if (report.checked.length < 2 || report.comparedTools.length === 0) {
    return null;
  }

  // Both signals are always compared, so say so rather than naming one.
  const basis = report.usedColours
    ? "tool colours and part assignments"
    : "part assignments";
  const fileCount = `${report.checked.length} files`;

  if (report.conflictingTools.length === 0) {
    return (
      <Alert status="success">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Tool assignments agree</Alert.Title>
          <Alert.Description>
            <span className="block text-sm">
              Compared the {basis} in {fileCount}: tool{" "}
              {list(report.comparedTools)}{" "}
              {report.comparedTools.length === 1 ? "means" : "mean"} the same
              thing in each. Safe to open together in Bambu Studio.
            </span>
            <span className="mt-1 block font-mono text-xs text-muted">
              {report.checked.join(" · ")}
            </span>
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {report.conflictingTools.length === 1
            ? "These files disagree about one tool"
            : `These files disagree about ${report.conflictingTools.length} tools`}
        </Alert.Title>
        {/* No per-tool breakdown: every file's colours are already listed
            against it just above, so restating them here adds nothing. */}
        <Alert.Description>
          Compared the {basis} in {fileCount}. Opening them together in Bambu
          Studio will need the filament assignments corrected by hand.
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
