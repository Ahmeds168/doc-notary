import { describe, expect, it } from "vitest";
import { PLANS } from "../lib/plans.js";
// The backend's source of truth for what each plan allows.
import { PLAN_CATALOG } from "../../../backend/src/lib/entitlements.js";

describe("pricing data", () => {
  it("matches the backend PLAN_CATALOG exactly", () => {
    expect(PLANS).toEqual(PLAN_CATALOG);
  });
});
