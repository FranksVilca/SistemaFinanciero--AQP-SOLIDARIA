import { describe, expect, it } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAMES } from "../../src/shared/dynamo.js";
import { clearAllTables, readDonation, readProject, seedDonation, seedProject } from "./helpers/seed.js";

describe("integration harness against DynamoDB Local", () => {
  it("stores and reads items in the project and donation tables", async () => {
    await clearAllTables();
    const project = await seedProject();
    const donation = await seedDonation("donor-smoke", String(project.projectId));

    expect((await readProject(String(project.projectId)))?.title).toBe(project.title);
    expect((await readDonation(String(donation.donationId)))?.donorSub).toBe("donor-smoke");
  });

  it("validates real update expressions inside a transaction", async () => {
    const project = await seedProject();
    const projectId = String(project.projectId);

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE_NAMES.projects,
              Key: { projectId },
              UpdateExpression: "ADD confirmedAmountCents :amount SET updatedAt = :now",
              ExpressionAttributeValues: { ":amount": 100, ":now": "2026-01-01T00:00:00.000Z" },
            },
          },
        ],
      })
    );

    expect((await readProject(projectId))?.confirmedAmountCents).toBe(100);
  });
});
