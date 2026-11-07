export const DYNAMO_ERROR = {
  transactionCanceled: "TransactionCanceledException",
  conditionalCheckFailed: "ConditionalCheckFailedException",
} as const;

export type DynamoErrorName = (typeof DYNAMO_ERROR)[keyof typeof DYNAMO_ERROR];

/** True when the error is the DynamoDB error with the given name; any other value is not a match. */
export function isDynamoError(error: unknown, name: DynamoErrorName): boolean {
  return error instanceof Error && error.name === name;
}
