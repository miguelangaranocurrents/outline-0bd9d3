import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { api, createCollection, createDocument, uniqueName } from "../support/api";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** Invites a user and signs them in with the emailed sign-in link or code. */
async function signInAsNewUser(page: Page, request: APIRequestContext, role: string) {
  const email = `${role}-${Date.now().toString(36)}@example.com`;
  const invited = await api(request, "users.invite", { invites: [{ email, name: "Gina Guest", role: "member" }] });
  await api(request, "users.update_role", { id: invited.users[0].id, role });

  await page.goto("/");
  await page.getByRole("button", { name: /Continue with Email/i }).click();
  await page.getByRole("textbox").first().fill(email);
  await page.keyboard.press("Enter");

  let body = "";
  await expect
    .poll(async () => {
      const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      const message = list.messages?.find((m: { Subject: string }) => /sign-in|sign in|code/i.test(m.Subject));
      if (!message) return "";
      body = (await (await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)).json()).Text;
      return body;
    }, { timeout: 30_000 })
    .not.toBe("");

  const link = body.match(/https?:\/\/\S+\/auth\/email\.callback\?\S+/)?.[0];
  if (link) {
    await page.goto(link);
  } else {
    const code = body.match(/\b\d{6}\b/)?.[0] ?? "";
    await page.getByRole("textbox").first().fill(code);
    await page.keyboard.press("Enter");
  }
  await expect(page).not.toHaveURL(/\/(login|auth)\b/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Account" }).first()).toBeVisible({ timeout: 30_000 });
  return invited.users[0] as { id: string };
}

test.describe("Sharing", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest who can edit a shared document can duplicate it", async ({ page, request }) => {
    const collection = await createCollection(request);
    const doc = await createDocument(request, {
      collectionId: collection.id,
      title: uniqueName("Vendor contract"),
      text: "Renewal is due in June.",
    });
    const guest = await signInAsNewUser(page, request, "guest");
    await api(request, "documents.add_user", { id: doc.id, userId: guest.id, permission: "read_write" });

    await page.goto(doc.url);
    await expect(page.getByText("Renewal is due in June.")).toBeVisible();
    await page.getByRole("button", { name: "Document options" }).first().click();
    await expect(page.getByRole("menuitem", { name: /Duplicate/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Duplicate/ })).toBeEnabled();
  });
});
