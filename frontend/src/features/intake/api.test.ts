import {
  createIntakeToken,
  savePublicDraft,
  submitPublicIntake,
  updateIntakeToken,
} from "./api";
import { publicEditableDraft } from "./constants";

beforeEach(() => {
  vi.restoreAllMocks();
});

it("saves and submits a public draft only within the encoded token path", async () => {
  const revision = "a".repeat(64);
  const response = { status: "editable", expires_at: "2031-01-01T00:00:00Z", draft: publicEditableDraft(null), revision };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ));
  const payload = publicEditableDraft(null);

  await savePublicDraft("safe_token-value", payload, revision);
  await submitPublicIntake("safe_token-value", payload, revision, "submit-idempotency-key-0001");

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/fill/safe_token-value",
    expect.objectContaining({ method: "PUT", body: JSON.stringify({ draft: payload, expected_revision: revision }) }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/fill/safe_token-value/submit",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ payload, expected_revision: revision, idempotency_key: "submit-idempotency-key-0001" }) }),
  );
});

it("creates and updates admin tokens with expiry and revision", async () => {
  const token = {
    id: 3,
    status: "active",
    expires_at: "2031-01-01T00:00:00Z",
    submitted_at: null,
    fill_path: "/fill/test",
    submission_status: null,
    revision: "a".repeat(64),
    created_at: "2030-01-01T00:00:00Z",
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify(token), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ));

  await createIntakeToken(14);
  await updateIntakeToken(3, "disabled", "a".repeat(64));

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/admin/intake/tokens",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ expires_in_days: 14 }) }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/admin/intake/tokens/3",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "disabled", expected_revision: "a".repeat(64) }),
    }),
  );
});
