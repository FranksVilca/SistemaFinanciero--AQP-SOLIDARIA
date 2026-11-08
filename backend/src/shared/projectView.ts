// Who donated and who created the project are identities: no public view exposes them.
const PRIVATE_FIELDS = ["donorSub", "createdBy"] as const;

/** Public view of a project: the project without the identities it carries. */
export function toPublicProject(project: Record<string, unknown>): Record<string, unknown> {
  const publicView = { ...project };
  for (const field of PRIVATE_FIELDS) {
    delete publicView[field];
  }
  return publicView;
}
