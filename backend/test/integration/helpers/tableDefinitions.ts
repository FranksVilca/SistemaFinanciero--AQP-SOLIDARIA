import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

export interface TableNames {
  projects: string;
  donations: string;
  idempotency: string;
  audit: string;
}

const stringAttribute = (name: string) => ({ AttributeName: name, AttributeType: "S" as const });
const keyElement = (name: string, type: "HASH" | "RANGE") => ({ AttributeName: name, KeyType: type });

// Mirrors the key schemas of infra/template.yaml.
export function buildTableDefinitions(names: TableNames): CreateTableCommandInput[] {
  return [
    {
      TableName: names.projects,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [stringAttribute("projectId"), stringAttribute("status"), stringAttribute("createdAt")],
      KeySchema: [keyElement("projectId", "HASH")],
      GlobalSecondaryIndexes: [
        {
          IndexName: "status-createdAt-index",
          KeySchema: [keyElement("status", "HASH"), keyElement("createdAt", "RANGE")],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    },
    {
      TableName: names.donations,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [stringAttribute("donationId"), stringAttribute("donorSub"), stringAttribute("createdAt")],
      KeySchema: [keyElement("donationId", "HASH")],
      GlobalSecondaryIndexes: [
        {
          IndexName: "donorSub-createdAt-index",
          KeySchema: [keyElement("donorSub", "HASH"), keyElement("createdAt", "RANGE")],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    },
    {
      TableName: names.idempotency,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [stringAttribute("pk")],
      KeySchema: [keyElement("pk", "HASH")],
    },
    {
      TableName: names.audit,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [stringAttribute("auditDay"), stringAttribute("timestamp#eventId")],
      KeySchema: [keyElement("auditDay", "HASH"), keyElement("timestamp#eventId", "RANGE")],
    },
  ];
}
