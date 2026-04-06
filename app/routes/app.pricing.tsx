import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import {
    Page, Layout, Card, Text, BlockStack, Button, InlineGrid, Badge, Divider,
    InlineStack, Banner, Box, Icon, ProgressBar, List,
} from "@shopify/polaris";
import {
    CheckCircleIcon, XCircleIcon, StarFilledIcon, CreditCardIcon,
} from "@shopify/polaris-icons";
import { PLAN_FREE, PLAN_STARTER, PLAN_BUSINESS, PLAN_PRO, PLANS } from "../plans";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// ── Helpers ──────────────────────────────────────────────────────────

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query ActiveSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price { amount currencyCode }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

async function getActiveSubscription(admin: any): Promise<{ id: string; name: string } | null> {
    const response = await admin.graphql(ACTIVE_SUBSCRIPTION_QUERY);
    const data = await response.json();
    const subs = data?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.find((s: any) => s.status === "ACTIVE");
    if (!active) return null;
    return { id: active.id, name: active.name };
}

// ── Helpers: effective order count ────────────────────────────────────

async function getRawMonthlyCount(shop: string): Promise<number> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return db.messageLog.count({
        where: { shop, createdAt: { gte: periodStart } },
    });
}

async function getPlanUsage(shop: string) {
    return db.planUsage.upsert({
        where: { shop },
        create: { shop },
        update: {},
    });
}

// ── Loader ───────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    const sub = await getActiveSubscription(admin);
    const activePlan = sub?.name ?? PLAN_FREE;

    const rawCount = await getRawMonthlyCount(session.shop);
    let usage = await getPlanUsage(session.shop);

    // ── Detect plan change confirmed on Shopify billing page ────────
    // If the active plan (from Shopify API) differs from what we stored,
    // the user just approved a new plan → update offset NOW.
    if (activePlan !== usage.currentPlan) {
        const currentEffective = Math.max(0, rawCount - usage.orderCountOffset);

        if (usage.previousPlanName === activePlan && usage.previousPlanCount !== null) {
            // Returning to a previous plan → restore its saved count
            usage = await db.planUsage.update({
                where: { shop: session.shop },
                data: {
                    currentPlan: activePlan,
                    orderCountOffset: rawCount - usage.previousPlanCount,
                    previousPlanName: usage.currentPlan,
                    previousPlanCount: currentEffective,
                },
            });
        } else {
            // Fresh switch → reset counter to 0
            usage = await db.planUsage.update({
                where: { shop: session.shop },
                data: {
                    currentPlan: activePlan,
                    orderCountOffset: rawCount,
                    previousPlanName: usage.currentPlan,
                    previousPlanCount: currentEffective,
                },
            });
        }
    }

    const planMeta = PLANS[activePlan] ?? PLANS[PLAN_FREE];

    return {
        activePlan,
        orderCount: rawCount,
        orderLimit: planMeta.orderLimit,
    };
};

// ── Action ───────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing, admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const selectedPlan = formData.get("plan") as string;

    if (!selectedPlan) {
        return { error: "Aucun plan sélectionné.", confirmationUrl: null };
    }

    const sub = await getActiveSubscription(admin);
    const currentPlan = sub?.name ?? PLAN_FREE;

    // Already on this plan
    if (selectedPlan === currentPlan) {
        return { error: null, confirmationUrl: null };
    }

    // ── Snapshot current effective count before switching ────────────
    const rawCount = await getRawMonthlyCount(session.shop);
    const usage = await getPlanUsage(session.shop);
    const currentEffective = Math.max(0, rawCount - usage.orderCountOffset);

    // ── Downgrade to Free ────────────────────────────────────────────
    if (selectedPlan === PLAN_FREE) {
        if (sub) {
            await billing.cancel({ subscriptionId: sub.id, prorate: true });
        }

        // If going back to the previous plan, restore its saved count
        if (usage.previousPlanName === PLAN_FREE && usage.previousPlanCount !== null) {
            await db.planUsage.update({
                where: { shop: session.shop },
                data: {
                    currentPlan: PLAN_FREE,
                    orderCountOffset: rawCount - (usage.previousPlanCount ?? 0),
                    previousPlanName: currentPlan,
                    previousPlanCount: currentEffective,
                },
            });
        } else {
            // Fresh switch: reset counter to 0
            await db.planUsage.update({
                where: { shop: session.shop },
                data: {
                    currentPlan: PLAN_FREE,
                    orderCountOffset: rawCount,
                    previousPlanName: currentPlan,
                    previousPlanCount: currentEffective,
                },
            });
        }

        return { error: null, confirmationUrl: null };
    }

    // ── Upgrade / switch to a paid plan ──────────────────────────────
    // Do NOT update PlanUsage here — the user hasn't approved the plan yet.
    // The loader will detect the plan change after Shopify billing approval.
    if ([PLAN_STARTER, PLAN_BUSINESS, PLAN_PRO].includes(selectedPlan)) {
        const returnUrl = `${process.env.SHOPIFY_APP_URL || new URL(request.url).origin}/app/pricing`;

        try {
            await billing.request({
                plan: selectedPlan as typeof PLAN_STARTER,
                isTest: true,
                returnUrl,
            });
        } catch (thrown: unknown) {
            if (thrown instanceof Response) {
                const confirmationUrl = thrown.headers.get(
                    "X-Shopify-API-Request-Failure-Reauthorize-Url",
                );
                if (confirmationUrl) {
                    return { error: null, confirmationUrl };
                }
                throw thrown;
            }
            console.error("Billing error:", thrown);
            const msg = thrown instanceof Error ? thrown.message : "Erreur lors de la facturation.";
            return { error: msg, confirmationUrl: null };
        }
    }

    return { error: "Plan invalide.", confirmationUrl: null };
};

// ── Plan display data ────────────────────────────────────────────────

const planCards = [
    {
        key: PLAN_FREE,
        name: "Free",
        price: "$0.00",
        period: "/ mois",
        description: "Inclus par défaut à l'installation.",
        orders: "30 commandes / mois",
        features: [
            { text: "30 commandes / mois", included: true },
            { text: "Envoi WhatsApp automatique", included: true },
            { text: "Support par email", included: true },
            { text: "Envoi vers Groupes", included: false },
            { text: "Support prioritaire", included: false },
        ],
        badge: null,
        highlight: false,
    },
    {
        key: PLAN_STARTER,
        name: "Starter",
        price: "$9.99",
        period: "/ mois",
        description: "Pour les boutiques en démarrage.",
        orders: "250 commandes / mois",
        features: [
            { text: "250 commandes / mois", included: true },
            { text: "Envoi WhatsApp automatique", included: true },
            { text: "Support par email", included: true },
            { text: "Envoi vers Groupes", included: true },
            { text: "Support prioritaire", included: false },
        ],
        badge: null,
        highlight: false,
    },
    {
        key: PLAN_BUSINESS,
        name: "Business",
        price: "$14.99",
        period: "/ mois",
        description: "Pour les boutiques en croissance.",
        orders: "600 commandes / mois",
        features: [
            { text: "600 commandes / mois", included: true },
            { text: "Envoi WhatsApp automatique", included: true },
            { text: "Support par email", included: true },
            { text: "Envoi vers Groupes", included: true },
            { text: "Support prioritaire", included: true },
        ],
        badge: "Populaire",
        highlight: true,
    },
    {
        key: PLAN_PRO,
        name: "Pro",
        price: "$24.99",
        period: "/ mois",
        description: "Pour les boutiques à fort volume.",
        orders: "Commandes illimitées",
        features: [
            { text: "Commandes illimitées", included: true },
            { text: "Envoi WhatsApp automatique", included: true },
            { text: "Support par email", included: true },
            { text: "Envoi vers Groupes", included: true },
            { text: "Support prioritaire", included: true },
        ],
        badge: null,
        highlight: false,
    },
];

// ── Component ────────────────────────────────────────────────────────

export default function Pricing() {
    const { activePlan, orderCount, orderLimit } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isSubmitting = navigation.state !== "idle";
    const submittingPlan = isSubmitting ? (navigation.formData?.get("plan") as string | null) : null;

    useEffect(() => {
        if (actionData?.confirmationUrl) {
            window.open(actionData.confirmationUrl, "_top");
        }
    }, [actionData]);

    const usagePercent = orderLimit !== null ? Math.min(100, Math.round((orderCount / orderLimit) * 100)) : 0;
    const isNearLimit = orderLimit !== null && usagePercent >= 80;

    const handleSelectPlan = (planKey: string) => {
        submit({ plan: planKey }, { method: "post" });
    };

    const currentPlanData = planCards.find((p) => p.key === activePlan) ?? planCards[0];

    return (
        <Page title="Abonnement" subtitle="Gérez votre plan et suivez votre consommation">
            <BlockStack gap="500">

                {actionData?.error && (
                    <Banner tone="critical" title="Erreur">
                        <Text as="p" variant="bodyMd">{actionData.error}</Text>
                    </Banner>
                )}

                {isNearLimit && (
                    <Banner tone="warning" title="Limite bientôt atteinte">
                        <Text as="p" variant="bodyMd">
                            Vous avez utilisé {usagePercent}% de vos commandes mensuelles. Pensez à passer au plan supérieur.
                        </Text>
                    </Banner>
                )}

                <Layout>
                    {/* Main column — plan cards */}
                    <Layout.Section>
                        <BlockStack gap="500">
                            <Card roundedAbove="sm">
                                <BlockStack gap="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="200" blockAlign="center">
                                            <Icon source={CreditCardIcon} tone="base" />
                                            <Text as="h2" variant="headingMd">Choisir un plan</Text>
                                        </InlineStack>
                                        <Text as="p" variant="bodySm" tone="subdued">Facturation mensuelle via Shopify</Text>
                                    </InlineStack>

                                    <Divider />

                                    <InlineGrid columns={{ xs: 1, sm: 2, lg: 2 }} gap="400">
                                        {planCards.map((plan) => {
                                            const isCurrent = plan.key === activePlan;

                                            return (
                                                <div
                                                    key={plan.key}
                                                    style={{
                                                        border: isCurrent
                                                            ? '2px solid var(--p-color-border-success)'
                                                            : plan.highlight
                                                                ? '2px solid var(--p-color-border-info)'
                                                                : '1px solid var(--p-color-border)',
                                                        borderRadius: 'var(--p-border-radius-300)',
                                                        padding: '16px',
                                                        position: 'relative',
                                                        backgroundColor: isCurrent ? 'var(--p-color-bg-surface-success)' : 'transparent',
                                                    }}
                                                >
                                                    <BlockStack gap="300">
                                                        <InlineStack align="space-between" blockAlign="center">
                                                            <Text variant="headingMd" as="h3">{plan.name}</Text>
                                                            <InlineStack gap="100">
                                                                {plan.badge && <Badge tone="info">{plan.badge}</Badge>}
                                                                {isCurrent && <Badge tone="success">Actuel</Badge>}
                                                            </InlineStack>
                                                        </InlineStack>

                                                        <Text variant="bodySm" as="p" tone="subdued">{plan.description}</Text>

                                                        <InlineStack align="start" blockAlign="end" gap="100">
                                                            <Text variant="heading2xl" as="p" fontWeight="bold">{plan.price}</Text>
                                                            <Text variant="bodySm" as="span" tone="subdued">{plan.period}</Text>
                                                        </InlineStack>

                                                        <Text variant="bodySm" as="p" tone="success" fontWeight="semibold">
                                                            {plan.orders}
                                                        </Text>

                                                        <Divider />

                                                        <BlockStack gap="150">
                                                            {plan.features.map((feature, i) => (
                                                                <InlineStack key={i} gap="200" blockAlign="center">
                                                                    <Box minWidth="16px">
                                                                        <Icon
                                                                            source={feature.included ? CheckCircleIcon : XCircleIcon}
                                                                            tone={feature.included ? "success" : "subdued"}
                                                                        />
                                                                    </Box>
                                                                    <Text as="p" variant="bodySm" tone={feature.included ? undefined : "subdued"}>
                                                                        {feature.text}
                                                                    </Text>
                                                                </InlineStack>
                                                            ))}
                                                        </BlockStack>

                                                        <Button
                                                            variant={isCurrent ? undefined : plan.highlight ? "primary" : "secondary"}
                                                            disabled={isCurrent || isSubmitting}
                                                            fullWidth
                                                            onClick={() => handleSelectPlan(plan.key)}
                                                            loading={submittingPlan === plan.key}
                                                        >
                                                            {isCurrent ? "Plan actuel" : `Choisir ${plan.name}`}
                                                        </Button>
                                                    </BlockStack>
                                                </div>
                                            );
                                        })}
                                    </InlineGrid>
                                </BlockStack>
                            </Card>
                        </BlockStack>
                    </Layout.Section>

                    {/* Sidebar */}
                    <Layout.Section variant="oneThird">
                        <BlockStack gap="500">

                            {/* Current plan summary */}
                            <Card roundedAbove="sm">
                                <BlockStack gap="300">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={StarFilledIcon} tone="success" />
                                        <Text as="h2" variant="headingMd">Plan actuel</Text>
                                    </InlineStack>
                                    <Divider />

                                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                        <BlockStack gap="200">
                                            <InlineStack align="space-between">
                                                <Text as="p" variant="bodyMd" fontWeight="bold">{currentPlanData.name}</Text>
                                                <Badge tone="success">{`${currentPlanData.price}${currentPlanData.period}`}</Badge>
                                            </InlineStack>
                                            <Text as="p" variant="bodySm" tone="subdued">{currentPlanData.description}</Text>
                                        </BlockStack>
                                    </Box>

                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="p" variant="bodyMd">Utilisation</Text>
                                            <Text as="p" variant="bodyMd" fontWeight="bold">
                                                {orderLimit !== null
                                                    ? `${orderCount} / ${orderLimit}`
                                                    : `${orderCount} (illimité)`
                                                }
                                            </Text>
                                        </InlineStack>
                                        {orderLimit !== null && (
                                            <ProgressBar
                                                progress={usagePercent}
                                                tone={usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "highlight" : "primary"}
                                                size="small"
                                            />
                                        )}
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            Commandes envoyées ce mois-ci
                                        </Text>
                                    </BlockStack>
                                </BlockStack>
                            </Card>

                            {/* FAQ */}
                            <Card roundedAbove="sm">
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Questions fréquentes</Text>
                                    <Divider />

                                    <BlockStack gap="300">
                                        <BlockStack gap="050">
                                            <Text as="p" variant="bodyMd" fontWeight="semibold">Quand le compteur se réinitialise-t-il ?</Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                Le compteur se réinitialise au début de chaque mois calendaire.
                                            </Text>
                                        </BlockStack>
                                        <BlockStack gap="050">
                                            <Text as="p" variant="bodyMd" fontWeight="semibold">Puis-je changer de plan à tout moment ?</Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                Oui. Passez à un plan supérieur ou inférieur quand vous le souhaitez. La facturation est ajustée au prorata.
                                            </Text>
                                        </BlockStack>
                                        <BlockStack gap="050">
                                            <Text as="p" variant="bodyMd" fontWeight="semibold">Que se passe-t-il si j'atteins la limite ?</Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                Les commandes au-delà de la limite ne seront plus envoyées automatiquement jusqu'au mois suivant ou un upgrade.
                                            </Text>
                                        </BlockStack>
                                    </BlockStack>
                                </BlockStack>
                            </Card>

                        </BlockStack>
                    </Layout.Section>
                </Layout>

                {/* Bottom spacing */}
                <div style={{ paddingBottom: '20px' }} />
            </BlockStack>
        </Page>
    );
}
