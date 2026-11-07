const DONOR_IDENTITY_FIELDS = ["donorSub"] as const;

/** Public views of a project never expose any donor identity. */
export function toPublicProject(project: Record<string, unknown>): Record<string, unknown> {
  const publicView = { ...project };
  for (const field of DONOR_IDENTITY_FIELDS) {
    delete publicView[field];
  }
  return publicView;
}
