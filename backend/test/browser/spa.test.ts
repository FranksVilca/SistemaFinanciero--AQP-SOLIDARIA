import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, bootLocalStack, type LocalStack } from "../floci/helpers/localStack.js";
import { deleteStack } from "../floci/helpers/stack.js";
import {
  emulatorContentSecurityPolicy,
  serveBuiltSite,
  startViteDevServer,
  type RunningSite,
} from "./helpers/staticSite.js";

/**
 * The SPA in a real browser, against the whole system running in Floci (real Lambda code, API Gateway with the
 * template's authorizer, scopes and CORS, emulated Cognito). Everything runs twice:
 *  - "built": the production build served with the content security policy of infra/template.yaml, so a blocked
 *    script, style or request shows up as a violation;
 *  - "vite dev": the server that `npm run local` starts, which is what a person opens (React runs its effects twice
 *    there, which broke the sign-in once).
 *
 * Needs Microsoft Edge or Chrome installed (BROWSER_CHANNEL=chrome to use Chrome), the Floci with the Docker socket and
 * port 3000 free: `npm run test:browser`.
 */

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const STACK = "zta-browser";
const SITE = "http://localhost:3000";
const OTHER_ORIGIN = "http://127.0.0.1:3000";
const SITES = ["built", "vite dev"] as const;

let stack: LocalStack;
let browser: Browser;

interface Watched {
  consoleErrors: string[];
}

async function newPage(trustCertificate = true): Promise<{ context: BrowserContext; page: Page; watched: Watched }> {
  // The emulator's certificate is not signed by a public authority; a person has to accept it once.
  const context = await browser.newContext({
    ignoreHTTPSErrors: trustCertificate,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const watched: Watched = { consoleErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") watched.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => watched.consoleErrors.push(`pageerror: ${error.message}`.slice(0, 300)));
  return { context, page, watched };
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Iniciar Sesión/ }).click();
  await page.waitForURL(/cognito-idp\/login/);
  await page.fill("#username", email);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await Promise.all([page.waitForURL(`${SITE}/`), page.locator('button[type="submit"]').click()]);
  await page.getByText(email).waitFor();
}

// The tokens live in memory only, so a full page load would sign the user out: move through the SPA's own router.
const goToRoute = (page: Page, path: string): Promise<void> =>
  page.evaluate((target) => {
    history.pushState({}, "", target);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);

const bodyText = async (page: Page): Promise<string> => (await page.locator("body").innerText()).replace(/\s+/g, " ");

beforeAll(async () => {
  stack = await bootLocalStack(STACK, "zta-browser-auth");
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
});

afterAll(async () => {
  await browser?.close();
  await deleteStack(STACK);
});

function frontendEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VITE_API_BASE_URL: `${stack.baseUrl}/v1`,
    VITE_COGNITO_AUTHORITY: stack.authority,
    VITE_COGNITO_CLIENT_ID: stack.pool.clientId,
  };
}

async function startSite(kind: (typeof SITES)[number]): Promise<RunningSite> {
  if (kind === "vite dev") return startViteDevServer(REPOSITORY_ROOT, 3000, frontendEnvironment());
  execSync("npm run build --workspace=frontend", { cwd: REPOSITORY_ROOT, stdio: "pipe", env: frontendEnvironment() });
  return serveBuiltSite(resolve(REPOSITORY_ROOT, "frontend/dist"), 3000, emulatorContentSecurityPolicy());
}

describe.each(SITES)("SPA served as: %s", (kind) => {
  let site: RunningSite;
  beforeAll(async () => {
    site = await startSite(kind);
  }, 600_000);
  afterAll(async () => {
    await site?.close();
  });

  it("renders the published projects with no console error and no policy violation", async () => {
    const { context, page, watched } = await newPage();

    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: /Ver detalle y donar/ })
      .first()
      .waitFor();

    expect(await page.getByRole("link", { name: /Ver detalle y donar/ }).count()).toBe(3);
    expect(await bodyText(page)).toContain("Iniciar Sesión");
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("is styled (the stylesheet is applied, not just present)", async () => {
    const { context, page } = await newPage();
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });

    const background = await page
      .locator("nav")
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await context.close();
  });

  it("signs a donor in with PKCE, keeps the tokens out of web storage, donates, approves and signs out revoking the token", async () => {
    const { context, page, watched } = await newPage();
    const revocations: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      if (response.url().endsWith("/oauth2/revoke"))
        revocations.push({ url: response.url(), status: response.status() });
    });

    await signIn(page, "donante@aqpsolidaria.pe");
    expect(await bodyText(page)).toContain("DONANTE");
    const storage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(storage).not.toMatch(/eyJ|access_token|refresh_token|id_token/);

    await page
      .getByRole("link", { name: /Ver detalle y donar/ })
      .first()
      .click();
    await page.getByRole("button", { name: /Registrar intención de donación/ }).click();
    await page.fill("#amount", "50");
    await page.getByRole("button", { name: /Confirmar Intención/ }).click();
    await page.getByText("PENDIENTE_SIMULACION").first().waitFor();
    await page.getByRole("button", { name: "Aceptar" }).click();

    await page.getByRole("link", { name: "Mis Donaciones" }).click();
    await page.getByText("PENDIENTE_SIMULACION").first().waitFor();
    await page
      .getByRole("button", { name: /Simular Aprobación/ })
      .first()
      .click();
    await page.getByText("CONFIRMADA_SIMULADA").first().waitFor();

    await page.getByRole("button", { name: /Salir/ }).click();
    await page.getByRole("button", { name: /Iniciar Sesión/ }).waitFor();
    expect(revocations).toHaveLength(1);
    expect(revocations[0].status).toBe(200);
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("does not reveal the reserved pages to a donor", async () => {
    const { context, page } = await newPage();
    await signIn(page, "donante@aqpsolidaria.pe");

    await page.getByRole("link", { name: "Mis Donaciones" }).waitFor();
    expect(await page.getByRole("link", { name: /Auditor|Auditoría/ }).count()).toBe(0);
    await goToRoute(page, "/auditor");
    await page.getByText("Acceso Reservado para Auditores").waitFor();
    await goToRoute(page, "/manager");
    await page.getByText("Acceso Reservado para Gestores").waitFor();
    await context.close();
  });

  it("lets the manager into the administration panel", async () => {
    const { context, page, watched } = await newPage();
    await signIn(page, "gestor@aqpsolidaria.pe");

    await page.getByRole("link", { name: /Gestión Proyectos/ }).click();
    await page.getByText("Panel de Administración de Proyectos").waitFor();

    expect(await bodyText(page)).toContain("GESTOR");
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("shows the auditor the trail with pseudonymized actors", async () => {
    const { context, page, watched } = await newPage();
    await signIn(page, "auditor@aqpsolidaria.pe");

    await page.getByRole("link", { name: /Auditoría/ }).click();
    await page.getByText("Registro Inmutable de Auditoría").waitFor();
    await page
      .getByText(/usr_[0-9a-f]{12}/)
      .first()
      .waitFor({ timeout: 30_000 });
    const text = await bodyText(page);

    expect(text).toContain("SUCCESS");
    expect(text).not.toContain("donante@aqpsolidaria.pe");
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("tells the person when the identity provider cannot be reached (certificate not trusted)", async () => {
    const { context, page } = await newPage(false);
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /Iniciar Sesión/ }).click();

    await page.getByRole("alert").filter({ hasText: "proveedor de identidad" }).waitFor({ timeout: 10_000 });
    expect(page.url()).toBe(`${SITE}/`);
    await context.close();
  });

  it("answers the origin of the SPA over CORS and refuses any other origin", async () => {
    const probe = (page: Page): Promise<string> =>
      page.evaluate(
        (url) =>
          fetch(url)
            .then((response) => `allowed ${response.status}`)
            .catch(() => "blocked"),
        `${stack.baseUrl}/v1/projects`
      );

    const allowed = await newPage();
    await allowed.page.goto(`${SITE}/`);
    expect(await probe(allowed.page)).toBe("allowed 200");
    await allowed.context.close();

    const foreign = await newPage();
    // Any page of another origin will do: the browser, not the page, enforces CORS.
    await foreign.page.route(`${OTHER_ORIGIN}/`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>other origin</title>" })
    );
    await foreign.page.goto(`${OTHER_ORIGIN}/`);
    expect(await probe(foreign.page)).toBe("blocked");
    await foreign.context.close();
  });
});
