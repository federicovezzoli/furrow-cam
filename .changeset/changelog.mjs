// Compact release notes (ADR-0027): `- summary (#pr)` per changeset, and one
// line listing the bumped internal dependencies instead of a commit-linked block.
import github from "@changesets/changelog-github";

export default {
  getReleaseLine: (changeset, type, options) =>
    github.getReleaseLine(changeset, type, { template: "- {summary} {ref}", ...options }),
  getDependencyReleaseLine: async (_changesets, dependenciesUpdated) =>
    dependenciesUpdated.length === 0
      ? ""
      : `- Updated dependencies: ${dependenciesUpdated.map((d) => `${d.name}@${d.newVersion}`).join(", ")}`,
};
