import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, bootLocalStack, type LocalStack } from "../floci/helpers/localStack.js";
import { signInSettings } from "../floci/helpers/gateway.js";
import { createUserInGroup, hostedSignIn } from "../floci/helpers/cognitoUsers.js";
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

/** Clicks the control that starts the sign-in and returns the window the identity provider opens. */
async function openSignInWindow(page: Page, startSignIn: () => Promise<void>): Promise<Page> {
  const [popup] = await Promise.all([page.waitForEvent("popup"), startSignIn()]);
  await popup.waitForURL(/cognito-idp\/login/);
  return popup;
}

async function completeSignIn(popup: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await popup.fill("#username", email);
  await popup.fill('input[name="password"]', password);
  await Promise.all([popup.waitForEvent("close"), popup.locator('button[type="submit"]').click()]);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  const popup = await openSignInWindow(page, () => page.getByRole("button", { name: /Iniciar Sesión/ }).click());
  await completeSignIn(popup, email);
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

    expect(await page.getByRole("link", { name: /Ver detalle y donar/ }).count()).toBeGreaterThanOrEqual(3);
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

  it("supports the donation journey at 375px with modal focus, Escape and cent amounts", async () => {
    const { context, page, watched } = await newPage();
    try {
      // The two serving modes share a stack. Keep this test's donation out of the demo donor's minute quota.
      const email = `qa-mobile-${kind.replace(/ /g, "-")}@aqpsolidaria.pe`;
      await createUserInGroup(stack.pool, email, "DONANTE");
      await signIn(page, email);
      await page.setViewportSize({ width: 375, height: 812 });
      const capture = async (name: string) => {
        const directory = resolve(REPOSITORY_ROOT, ".local/qa", kind.replace(/ /g, "-"));
        await mkdir(directory, { recursive: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
      };
      await capture("catalog-375");
      await page
        .getByRole("link", { name: /Ver detalle y donar/ })
        .first()
        .click();
      const opener = page.getByRole("button", { name: /Registrar intención de donación/ });
      await opener.waitFor();
      await capture("detail-375");
      await opener.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < 8; index++) {
          await page.keyboard.press(key);
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        }
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect(await opener.evaluate((node) => node === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await page.getByLabel("Monto en Soles (PEN)").fill("1.01");
      await capture("donation-375");
      await page.getByRole("button", { name: "Confirmar Intención" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "¡Intención Registrada!" }).waitFor();
      expect(await dialog.getAttribute("aria-labelledby")).toBe("donation-modal-title");
      expect(await page.locator("#donation-modal-title").innerText()).toBe("¡Intención Registrada!");
      await capture("confirmation-375");
      await page.getByRole("button", { name: "Aceptar" }).focus();
      await page.keyboard.press("Enter");
      expect(await opener.evaluate((node) => node === document.activeElement)).toBe(true);
      expect(watched.consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
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

  it("shows a new donation in the history that was opened before, and the approved amount in the catalog", async () => {
    const { context, page, watched } = await newPage();
    const donationCount = async (): Promise<number> => page.getByText(/^ID: /).count();
    const raisedByFirstProject = async (): Promise<number> => {
      await page.getByRole("link", { name: "Proyectos" }).first().click();
      await page
        .getByRole("link", { name: /Ver detalle y donar/ })
        .first()
        .waitFor();
      const raised = (await bodyText(page)).match(/Recaudado: S\/\s*([\d,.]+)/)?.[1] ?? "";
      return Number(raised.replace(/,/g, ""));
    };
    await signIn(page, "donante@aqpsolidaria.pe");

    // Open the history first, so it is in the cache before the donation exists.
    await page.getByRole("link", { name: "Mis Donaciones" }).click();
    await page.getByRole("heading", { name: /Mi Historial de Donaciones/ }).waitFor();
    // The list is loaded when the loading indicator is gone: counting earlier would read an empty list.
    await page.getByRole("status").waitFor({ state: "detached" });
    const donationsBefore = await donationCount();
    const raisedBefore = await raisedByFirstProject();

    await page
      .getByRole("link", { name: /Ver detalle y donar/ })
      .first()
      .click();
    await page.getByRole("button", { name: /Registrar intención de donación/ }).click();
    await page.fill("#amount", "50");
    await page.getByRole("button", { name: /Confirmar Intención/ }).click();
    await page.getByText("Simular Aprobación").first().waitFor(); // the success message says what to do next
    await page.getByRole("button", { name: "Aceptar" }).click();

    await page.getByRole("link", { name: "Mis Donaciones" }).click();
    await expect.poll(donationCount, { timeout: 15_000 }).toBe(donationsBefore + 1);

    await page
      .getByRole("button", { name: /Simular Aprobación/ })
      .first()
      .click();
    await page.getByText("CONFIRMADA_SIMULADA").first().waitFor();

    // The catalog had the old amount cached: it must show the approved donation without a reload.
    await expect.poll(raisedByFirstProject, { timeout: 15_000 }).toBe(raisedBefore + 50);
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("ends the hosted UI session at sign-out, so the next sign-in asks for credentials and can be another account", async () => {
    // One browser context throughout: the hosted UI remembers the person in a cookie, as it does for a real user.
    const { context, page, watched } = await newPage();
    await signIn(page, "auditor@aqpsolidaria.pe");
    expect(await bodyText(page)).toContain("AUDITOR");

    await page.getByRole("button", { name: /Salir/ }).click();
    await page.getByRole("button", { name: /Iniciar Sesión/ }).waitFor();

    // Not straight back in as the auditor: the sign-in form is shown again.
    const popup = await openSignInWindow(page, () => page.getByRole("button", { name: /Iniciar Sesión/ }).click());
    await completeSignIn(popup, "donante@aqpsolidaria.pe");
    await page.getByText("donante@aqpsolidaria.pe").waitFor();

    const text = await bodyText(page);
    expect(text).toContain("DONANTE");
    expect(text).not.toContain("AUDITOR");
    expect(text).not.toContain("auditor@aqpsolidaria.pe");
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

  it("sends an anonymous visitor who tries to donate to the sign-in page", async () => {
    const { context, page } = await newPage();
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: /Ver detalle y donar/ })
      .first()
      .click();

    await page.getByRole("button", { name: /Registrar intención de donación/ }).click();
    await page.getByText("Debes iniciar sesión").waitFor();

    const popup = await openSignInWindow(page, () =>
      page.getByRole("button", { name: /Iniciar sesión con Cognito/ }).click()
    );
    expect(popup.url()).toMatch(/cognito-idp\/login/);
    expect(page.url()).toContain("/projects/"); // the person kept their place in the app
    await context.close();
  });

  it("keeps the person on the sign-in page when the password is wrong", async () => {
    const { context, page } = await newPage();
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
    const popup = await openSignInWindow(page, () => page.getByRole("button", { name: /Iniciar Sesión/ }).click());

    await popup.fill("#username", "donante@aqpsolidaria.pe");
    await popup.fill('input[name="password"]', "NotThePassword1!");
    await popup.locator('button[type="submit"]').click();
    await popup.waitForLoadState("networkidle");

    expect(popup.isClosed()).toBe(false);
    expect(popup.url()).toMatch(/cognito-idp\/login/);
    expect(await page.getByRole("button", { name: /Iniciar Sesión/ }).count()).toBe(1); // still signed out
    await context.close();
  });

  it("does nothing, and shows no error, when the person closes the sign-in window", async () => {
    const { context, page, watched } = await newPage();
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
    const popup = await openSignInWindow(page, () => page.getByRole("button", { name: /Iniciar Sesión/ }).click());

    await popup.close();
    await page.waitForTimeout(1_500); // the page notices the closed window

    expect(await page.getByRole("alert").count()).toBe(0);
    expect(await page.getByRole("button", { name: /Iniciar Sesión/ }).count()).toBe(1);
    expect(watched.consoleErrors).toEqual([]);
    await context.close();
  });

  it("continues the sign-in in the whole page when the browser blocks the window", async () => {
    const { context, page } = await newPage();
    await page.addInitScript(() => {
      window.open = () => null; // what a popup blocker answers
    });
    await page.goto(`${SITE}/`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /Iniciar Sesión/ }).click();

    await page.waitForURL(/cognito-idp\/login/);
    await page.fill("#username", "donante@aqpsolidaria.pe");
    await page.fill('input[name="password"]', DEMO_PASSWORD);
    await Promise.all([page.waitForURL(`${SITE}/`), page.locator('button[type="submit"]').click()]);
    await page.getByText("donante@aqpsolidaria.pe").waitFor();
    await context.close();
  });

  it.each(["auditor@aqpsolidaria.pe", "gestor@aqpsolidaria.pe"])(
    "does not offer %s the donation button, and the API refuses and audits a forced attempt",
    async (email) => {
      const { context, page, watched } = await newPage();
      const projects = (await (await fetch(`${stack.baseUrl}/v1/projects`)).json()) as Array<{ projectId: string }>;
      const projectId = projects[0].projectId;

      await signIn(page, email);
      await page
        .getByRole("link", { name: /Ver detalle y donar/ })
        .first()
        .click();
      await page.getByRole("note").filter({ hasText: "rol DONANTE" }).waitFor();
      expect(await page.getByRole("button", { name: /Registrar intención de donación/ }).count()).toBe(0);

      // What a hand-made request does: the role check refuses it in the API whatever the page shows.
      const { scopes, redirectUri } = signInSettings();
      const tokens = await hostedSignIn(stack.pool, email, scopes, redirectUri);
      const forced = await fetch(`${stack.baseUrl}/v1/donations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ projectId, amountCents: 5_000 }),
      });
      expect(forced.status).toBe(403);
      expect(watched.consoleErrors).toEqual([]);
      await context.close();

      const auditor = await newPage();
      await signIn(auditor.page, "auditor@aqpsolidaria.pe");
      await auditor.page.getByRole("link", { name: /Auditoría/ }).click();
      await auditor.page.getByText(`project:${projectId}`).first().waitFor({ timeout: 30_000 });
      const row = auditor.page.locator("tr", { hasText: `project:${projectId}` }).filter({ hasText: "DENIED" });
      expect(await row.count()).toBeGreaterThan(0);
      expect(await row.first().innerText()).toContain("CreateDonation");
      await auditor.context.close();
    }
  );

  it("lets the manager create a project, see its identifier, publish it and see it in the public catalog", async () => {
    const { context, page, watched } = await newPage();
    const title = `Comedor de prueba (${kind})`;
    await signIn(page, "gestor@aqpsolidaria.pe");
    await page.getByRole("link", { name: /Gestión Proyectos/ }).click();

    await page.fill("#proj-title", title);
    await page.fill("#proj-desc", "Un comedor para la comunidad, creado desde la prueba de navegador.");
    await page.fill("#proj-goal", "300");
    await page.getByRole("button", { name: /Guardar Proyecto como BORRADOR/ }).click();
    const created = await page.getByText(/Identificador: [0-9a-f-]{36}/).innerText();
    const projectId = /([0-9a-f-]{36})/.exec(created)?.[1];
    expect(projectId).toBeDefined();
    expect(await page.inputValue("#pub-id")).toBe(projectId);

    // A draft is not public yet.
    const draftCatalog = (await (await fetch(`${stack.baseUrl}/v1/projects`)).json()) as Array<{ title: string }>;
    expect(draftCatalog.map((project) => project.title)).not.toContain(title);

    await page.getByRole("button", { name: /Publicar en el Catálogo Público/ }).click();
    await page.getByText(/publicado con éxito/).waitFor();
    const published = (await (await fetch(`${stack.baseUrl}/v1/projects`)).json()) as Array<{ title: string }>;
    expect(published.map((project) => project.title)).toContain(title);
    expect(watched.consoleErrors).toEqual([]);
    await context.close();

    const visitor = await newPage();
    await visitor.page.goto(`${SITE}/`, { waitUntil: "networkidle" });
    await visitor.page.getByText(title).waitFor();
    await visitor.context.close();
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
