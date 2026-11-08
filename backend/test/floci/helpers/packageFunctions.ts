import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const INSTALL_TIMEOUT_MS = 180_000;

function addDirectory(zip: JSZip, root: string, directory: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) addDirectory(zip, root, path);
    else zip.file(relative(root, path).split(sep).join("/"), readFileSync(path));
  }
}

/**
 * Builds the deployment package the way `sam build` does for these functions: the compiled code of backend/dist plus
 * its production dependencies (the AWS SDK is provided by the Lambda runtime), zipped.
 */
export async function packageFunctions(): Promise<Buffer> {
  execSync("npm run build", { cwd: BACKEND_ROOT, stdio: "pipe" });

  const workDirectory = mkdtempSync(join(tmpdir(), "aqp-functions-"));
  try {
    cpSync(join(BACKEND_ROOT, "dist"), workDirectory, { recursive: true });
    execSync("npm install --omit=dev --no-audit --no-fund --ignore-scripts", {
      cwd: workDirectory,
      stdio: "pipe",
      timeout: INSTALL_TIMEOUT_MS,
    });

    const zip = new JSZip();
    addDirectory(zip, workDirectory, workDirectory);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}
