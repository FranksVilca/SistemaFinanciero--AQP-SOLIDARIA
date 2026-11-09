// What the review records about a donation: why it was held and who decided, with what argument. The donor must not
// learn how the anti-fraud controls work or who reviewed them, so no donor view carries these fields.
const INTERNAL_REVIEW_FIELDS = ["reviewReasons", "reviewedBy", "reviewMotivo"] as const;

/** View of a donation for its own donor: the donation without the internal fields of its review. */
export function toDonorView<T extends Record<string, unknown>>(donation: T): Record<string, unknown> {
  const view: Record<string, unknown> = { ...donation };
  for (const field of INTERNAL_REVIEW_FIELDS) delete view[field];
  return view;
}
