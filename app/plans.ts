export const PLAN_FREE = "Free";
export const PLAN_STARTER = "Starter";
export const PLAN_BUSINESS = "Business";
export const PLAN_PRO = "Pro";

export const PLANS: Record<string, { name: string; orderLimit: number | null }> = {
  [PLAN_FREE]:     { name: "Free",     orderLimit: 30 },
  [PLAN_STARTER]:  { name: "Starter",  orderLimit: 250 },
  [PLAN_BUSINESS]: { name: "Business", orderLimit: 600 },
  [PLAN_PRO]:      { name: "Pro",      orderLimit: null }, // unlimited
};
