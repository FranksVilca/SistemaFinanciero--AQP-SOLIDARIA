import { beforeEach, describe, expect, it } from "vitest";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as getProject } from "../../src/projects/getProject.js";
import { handler as getProjectStats } from "../../src/projects/getProjectStats.js";
import { handler as listProjects } from "../../src/projects/listProjects.js";
import { handler as publishProject } from "../../src/projects/publishProject.js";
import { PROJECT_STATUS } from "../../src/shared/constants.js";
import { buildEvent, identityFor, parseBody } from "./helpers/events.js";
import { clearAllTables, readProject, seedProject } from "./helpers/seed.js";

const validProject = {
  title: "Agua para Chivay",
  description: "Instalar un sistema de agua potable",
  goalAmountCents: 100_000,
};

describe("project catalog and management", () => {
  beforeEach(clearAllTables);

  it("lists only published projects and never exposes a donor identity", async () => {
    const published = await seedProject({ title: "Publicado", donorSub: "should-not-leak" });
    await seedProject({ title: "Borrador", status: PROJECT_STATUS.draft });

    const projects = parseBody<Array<Record<string, unknown>>>(await listProjects(buildEvent()));

    expect(projects.map((project) => project.projectId)).toEqual([published.projectId]);
    expect(JSON.stringify(projects)).not.toContain("should-not-leak");
  });

  it("answers 404 for a draft project to visitors", async () => {
    const draft = await seedProject({ status: PROJECT_STATUS.draft });
    const pathParameters = { projectId: String(draft.projectId) };

    expect((await getProject(buildEvent({ pathParameters }))).statusCode).toBe(404);
    expect((await getProjectStats(buildEvent({ pathParameters }))).statusCode).toBe(404);
  });

  it("returns the progress of a published project", async () => {
    const project = await seedProject({ goalAmountCents: 10_000, confirmedAmountCents: 2_500 });

    const stats = parseBody(
      await getProjectStats(buildEvent({ pathParameters: { projectId: String(project.projectId) } }))
    );

    expect(stats).toMatchObject({ confirmedAmountCents: 2_500, goalAmountCents: 10_000, progressPercentage: 25 });
  });

  it("lets a manager create a draft and publish it once", async () => {
    const manager = identityFor("GESTOR");

    const created = await createProject(buildEvent({ identity: manager, body: validProject }));
    const projectId = String(parseBody(created).projectId);
    expect(created.statusCode).toBe(201);
    expect((await readProject(projectId))?.status).toBe(PROJECT_STATUS.draft);

    const publish = () => publishProject(buildEvent({ identity: manager, pathParameters: { projectId } }));
    expect((await publish()).statusCode).toBe(200);
    expect((await readProject(projectId))?.status).toBe(PROJECT_STATUS.published);
    expect((await publish()).statusCode).toBe(409);
  });

  it("rejects an invalid project with 400", async () => {
    const response = await createProject(
      buildEvent({ identity: identityFor("GESTOR"), body: { ...validProject, title: "x" } })
    );

    expect(response.statusCode).toBe(400);
  });
});
