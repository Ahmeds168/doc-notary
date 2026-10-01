// Operator tool: set a user's plan until the Kelviq sync is wired up.
//   node scripts/set-plan.js <user-uuid> <free|standard>
// Uses the same store.setUserPlan() path the future Kelviq webhook will call (source "kelviq").
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createStore } from "../src/lib/supabase.js";
import { PLAN_CATALOG } from "../src/lib/entitlements.js";

const [userId, plan] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(userId ?? "") || !PLAN_CATALOG[plan]) {
  console.error("Usage: node scripts/set-plan.js <user-uuid> <free|standard>");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const profile = await createStore(supabase).setUserPlan(userId, plan, "manual");
console.log(`User ${profile.id} is now on the ${profile.plan} plan.`);
