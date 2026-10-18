import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const testPassword = "Browser-Workflow-Password-42!";

async function registerAccount(page: Page) {
  const email = `browser-${randomUUID()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Browser Workflow User");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByLabel("Confirm password").fill(testPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to APISentinel" })).toBeVisible();
  return email;
}

function waitForAlertUpdate(page: Page) {
  return page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return requestUrl.pathname.startsWith("/alerts/") && response.request().method() === "PATCH";
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

test("users can register, sign out, and sign back in", async ({ page }) => {
  const email = await registerAccount(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to APISentinel" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("manual analysis persists a normal prediction in request history", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "API request analyzer" }).click();

  await page.getByLabel("Request URL").fill("/stage-b-regression");
  await page.getByRole("button", { name: "Analyze request" }).click();
  await expect(page.getByRole("heading", { name: "NORMAL", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Request history" }).click();
  await expect(page.getByRole("heading", { name: "Request history" })).toBeVisible();
  const historyRow = page.getByRole("row", { name: /\/stage-b-regression/ });
  await expect(historyRow).toContainText("GET");
  await expect(historyRow).toContainText("NORMAL");
});

test("anomalous predictions can be reviewed and annotated from alerts", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "API request analyzer" }).click();

  await page.getByLabel("HTTP method").selectOption("POST");
  await page.getByLabel("Request URL").fill("/api/search?q=1");
  await page.getByLabel("Request payload").fill("<script>alert(1)</script>");
  await page.getByRole("button", { name: "Analyze request" }).click();
  await expect(page.getByRole("heading", { name: "ANOMALOUS", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Security alerts" }).click();
  const alertCard = page.locator("article").filter({ hasText: "/api/search?q=1" });
  await expect(alertCard).toBeVisible();
  const reviewStatus = alertCard.getByRole("combobox", { name: "Alert review status" });
  const statusUpdate = waitForAlertUpdate(page);
  await reviewStatus.selectOption("Under Review");
  expect((await statusUpdate).ok()).toBeTruthy();
  await expect(reviewStatus).toHaveValue("Under Review");

  await alertCard.getByRole("link", { name: "Investigate" }).click();
  await expect(page.getByRole("heading", { name: "Incident investigation" })).toBeVisible();
  const notes = page.getByLabel("Investigation notes");
  await notes.fill("Reviewed suspicious request indicators.");
  const notesUpdate = waitForAlertUpdate(page);
  await page.getByRole("button", { name: "Save notes" }).click();
  expect((await notesUpdate).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByLabel("Investigation notes")).toHaveValue(
    "Reviewed suspicious request indicators.",
  );
  await expect(page.getByLabel("Review status")).toHaveValue("Under Review");
});

test("website management creates and retains a one-time integration credential", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "Website management" }).click();
  await page.getByRole("button", { name: "Add website" }).first().click();

  const websiteName = `Browser Test API ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Display name").fill(websiteName);
  await page.getByLabel("Base URL").fill("https://api.example.test");
  await page.getByLabel("Integration type").selectOption("manual");
  await page.getByRole("button", { name: "Register website" }).click();

  const websiteCard = page.locator("article").filter({ hasText: websiteName });
  await expect(websiteCard).toBeVisible();
  await expect(websiteCard).toContainText("NOT CONNECTED");
  await websiteCard.getByRole("button", { name: "Create key" }).click();

  const credentialPanel = page.locator('[aria-label="One-time integration credential"]');
  await expect(credentialPanel.getByRole("heading", { name: "Save this credential now" })).toBeVisible();
  const displayedCredentialLength = await credentialPanel.locator("code").evaluate(
    (element) => element.textContent?.trim().length ?? 0,
  );
  expect(displayedCredentialLength).toBeGreaterThan(0);
  await expect(websiteCard.getByRole("button", { name: "Rotate key" })).toBeVisible();

  await page.getByRole("button", { name: "I’ve saved it — hide credential" }).click();
  await expect(credentialPanel).toHaveCount(0);
  await page.reload();
  await expect(page.locator("article").filter({ hasText: websiteName })
    .getByRole("button", { name: "Rotate key" })).toBeVisible();
});

test("local CSV preview enforces file, row, and column limits", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "Batch CSV analyzer" }).click();
  const fileInput = page.locator('input[type="file"]');
  const maxFileBytes = 1024 * 1024;
  const validPrefix = "url,payload\n/api/preview,body\n";
  const belowSizeLimit = validPrefix + "\n".repeat(maxFileBytes - 1 - validPrefix.length);

  await fileInput.setInputFiles({
    name: "size-boundary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(belowSizeLimit),
  });
  await expect(page.getByText(/size-boundary\.csv · previewing/)).toBeVisible();

  await fileInput.setInputFiles({
    name: "oversized.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(validPrefix + "\n".repeat(maxFileBytes + 1 - validPrefix.length)),
  });
  await expect(page.getByRole("alert")).toHaveText("CSV exceeds the 1 MiB preview size limit.");

  await fileInput.setInputFiles({
    name: "row-boundary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `url,payload\n${Array.from({ length: 1_000 }, (_, index) => `/row/${index},body`).join("\n")}`,
    ),
  });
  await expect(page.getByText(/row-boundary\.csv · previewing 10 of at most 10 rows/)).toBeVisible();

  await fileInput.setInputFiles({
    name: "too-many-rows.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `url,payload\n${Array.from({ length: 1_001 }, (_, index) => `/row/${index},body`).join("\n")}`,
    ),
  });
  await expect(page.getByRole("alert")).toHaveText("CSV exceeds the maximum of 1,000 data rows.");

  const columnsAtLimit = ["url", "payload", ...Array.from({ length: 30 }, (_, index) => `extra${index}`)];
  await fileInput.setInputFiles({
    name: "column-boundary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${columnsAtLimit.join(",")}\n/row,body,${",".repeat(29)}`),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported columns:");

  await fileInput.setInputFiles({
    name: "too-many-columns.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${[...columnsAtLimit, "extra30"].join(",")}\n/row,body`),
  });
  await expect(page.getByRole("alert")).toHaveText("CSV exceeds the maximum of 32 columns.");
});

test("batch analysis validates rows, processes sequentially, and exports escaped results", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "Batch CSV analyzer" }).click();

  const submitted: Array<{ method: string; url: string; payload: string }> = [];
  let releaseFirstRequest!: () => void;
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  await page.route("**/predict", async (route) => {
    const request = route.request().postDataJSON() as {
      method: string;
      url: string;
      payload: string;
    };
    submitted.push(request);
    if (request.url === "/safe, \"quoted\"") await firstRequestGate;
    if (request.url === "/fail") {
      await route.fulfill({ status: 503, json: { detail: "Simulated request failure" } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        prediction: "normal",
        class_id: 0,
        confidence: 0.91,
        probabilities: { normal: 0.91, anomalous: 0.09 },
        features: {
          payload_len: request.payload.length,
          url_len: request.url.length,
          param_count: 0,
          special_char_count: 0,
          digit_count: 0,
          encoded_char_count: 0,
          path_depth: 1,
          payload_entropy: 0,
        },
        method: request.method,
        url: request.url,
      },
    });
  });

  const oversizedUrl = `/${"u".repeat(8_192)}`;
  const oversizedPayload = "p".repeat(256 * 1024 + 1);
  await page.locator('input[type="file"]').setInputFiles({
    name: "batch.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "url,payload,method",
        '"/safe, ""quoted""",,  ',
        "/fail,body,post",
        ",missing,GET",
        "/path,,GET",
        "/malformed,only",
        `${oversizedUrl},body,GET`,
        `/payload,${oversizedPayload},GET`,
      ].join("\n"),
    ),
  });

  await expect(page.getByRole("region", { name: "CSV preview" }).getByText("Total rows: 7")).toBeVisible();
  await expect(page.getByText("Completed rows: 4 of 7")).toBeVisible();
  await expect(page.getByRole("row", { name: /4.*URL is required/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /6.*Expected 3 columns but found 2/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /7.*URL exceeds the 8,192-character limit/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /8.*Payload exceeds the 256 KiB character limit/ })).toBeVisible();

  const runButton = page.getByRole("button", { name: "Analyze valid rows" });
  await runButton.click();
  await expect(page.getByText("Processing row 2 of 7…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyzing rows…" })).toBeDisabled();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toEqual({ method: "GET", url: '/safe, "quoted"', payload: "" });

  releaseFirstRequest();
  await expect(page.getByText("Batch partially completed: 2 succeeded, 5 failed.")).toBeVisible();
  await expect(page.getByText("Completed rows: 7 of 7")).toBeVisible();
  expect(submitted).toEqual([
    { method: "GET", url: '/safe, "quoted"', payload: "" },
    { method: "POST", url: "/fail", payload: "body" },
    { method: "GET", url: "/path", payload: "" },
  ]);
  await expect(page.getByText(/successful prediction responses could not be confirmed/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download results CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("apisentinel-batch-results.csv");
  const downloadedCsv = await readFile((await download.path())!, "utf8");
  expect(downloadedCsv).toContain(
    '"2","/safe, ""quoted""","GET","normal","Completed"',
  );
  expect(downloadedCsv).toContain(
    '"3","/fail","POST","","Failed: Simulated request failure"',
  );
  expect(downloadedCsv).toContain('"4","","GET","","Failed: URL is required."');
  expect(downloadedCsv).toContain(
    '"6","/malformed","GET","","Failed: Expected 3 columns but found 2."',
  );
  expect(downloadedCsv).toContain(
    '"7","' + oversizedUrl + '","GET","","Failed: URL exceeds the 8,192-character limit."',
  );
  expect(downloadedCsv).toContain(
    '"8","/payload","GET","","Failed: Payload exceeds the 256 KiB character limit."',
  );
  expect(submitted).toHaveLength(3);

  await page.getByRole("button", { name: "Reset batch" }).click();
  await expect(page.getByRole("region", { name: "CSV preview" }).getByText("Total rows: 7")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analyze valid rows" })).toBeDisabled();
});

test("live monitoring displays owned event metadata and refreshes manually and periodically", async ({ page }) => {
  await registerAccount(page);
  await page.getByRole("link", { name: "Website management" }).click();
  await page.getByRole("button", { name: "Add website" }).first().click();
  await page.getByLabel("Display name").fill("Browser Test API");
  await page.getByLabel("Base URL").fill("https://api.example.test");
  await page.getByLabel("Integration type").selectOption("manual");
  await page.getByRole("button", { name: "Register website" }).click();
  const websiteCard = page.locator("article").filter({ hasText: "Browser Test API" });
  await expect(websiteCard).toBeVisible();
  await websiteCard.getByRole("button", { name: "Create key" }).click();
  const credentialPanel = page.locator('[aria-label="One-time integration credential"]');
  const credential = (await credentialPanel.locator("code").textContent())?.trim();
  expect(credential).toBeTruthy();

  async function submitEvent(eventId: string, endpoint: string) {
    const response = await page.request.post("http://127.0.0.1:8001/monitoring/events", {
      headers: { "X-APISentinel-Integration-Key": credential! },
      data: {
        schema_version: "1",
        event_id: eventId,
        event_timestamp: new Date().toISOString(),
        method: "GET",
        endpoint,
        response_status: 200,
        request_duration_ms: 12.5,
        request_size_bytes: 24,
      },
    });
    expect(response.ok()).toBeTruthy();
  }

  await submitEvent("browser-monitor-first", "/api/first");
  await page.getByRole("link", { name: "Live request monitoring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live request monitoring" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Browser Test API GET \/api\/first 200/ })).toBeVisible();
  await expect(page.getByText("Not Scored")).toBeVisible();
  await expect(page.getByRole("cell", { name: "—" })).toHaveCount(2);

  await submitEvent("browser-monitor-refresh", "/api/refreshed");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("row", { name: /Browser Test API GET \/api\/refreshed 200/ })).toBeVisible();

  await submitEvent("browser-monitor-periodic", "/api/periodic");
  await expect(page.getByRole("row", { name: /Browser Test API GET \/api\/periodic 200/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Last refreshed/)).toBeVisible();
});
