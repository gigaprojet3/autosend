import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import { Page, Card, Text, BlockStack, Button, InlineGrid, Badge, Divider, InlineStack, Banner } from "@shopify/polaris";
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

// ── Loader ───────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    const sub = await getActiveSubscription(admin);
    const activePlan = sub?.name ?? PLAN_FREE;

    // Count orders sent this billing period (current calendar month)
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const orderCount = await db.messageLog.count({
        where: {
            shop: session.shop,
            status: "SENT",
            createdAt: { gte: periodStart },
        },
    });

    const planMeta = PLANS[activePlan] ?? PLANS[PLAN_FREE];

    return {
        activePlan,
        orderCount,
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

    // ── Downgrade to Free ────────────────────────────────────────────
    if (selectedPlan === PLAN_FREE) {
        if (sub) {
            await billing.cancel({ subscriptionId: sub.id, prorate: true });
        }
        return { error: null, confirmationUrl: null };
    }

    // ── Upgrade / switch to a paid plan ──────────────────────────────
    if ([PLAN_STARTER, PLAN_BUSINESS, PLAN_PRO].includes(selectedPlan)) {
        const returnUrl = `${process.env.SHOPIFY_APP_URL || new URL(request.url).origin}/app/pricing`;

        try {
            // billing.request() ALWAYS throws — it never returns.
            // For XHR: throws 401 with confirmation URL in header
            // For embedded: throws redirect to exitIframe path
            // For non-embedded: throws redirect to confirmation URL
            await billing.request({
                plan: selectedPlan as typeof PLAN_STARTER,
                isTest: true,
                returnUrl,
            });
        } catch (thrown: unknown) {
            if (thrown instanceof Response) {
                // XHR path: 401 with billing confirmation URL in header
                const confirmationUrl = thrown.headers.get(
                    "X-Shopify-API-Request-Failure-Reauthorize-Url",
                );
                if (confirmationUrl) {
                    return { error: null, confirmationUrl };
                }
                // Embedded/document path: redirect Response — let React Router handle it
                throw thrown;
            }
            // Actual billing error (e.g. Managed Pricing conflict)
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

    // When the action returns a confirmationUrl, redirect the top-level
    // window to Shopify's billing confirmation page.
    useEffect(() => {
        if (actionData?.confirmationUrl) {
            window.open(actionData.confirmationUrl, "_top");
        }
    }, [actionData]);

    const usageText = orderLimit !== null
        ? `${orderCount} / ${orderLimit} commandes utilisées ce mois-ci`
        : `${orderCount} commandes envoyées ce mois-ci (illimité)`;

    const handleSelectPlan = (planKey: string) => {
        submit({ plan: planKey }, { method: "post" });
    };

    return (
        <Page title="Plan d'abonnement">
            <BlockStack gap="400">
                {actionData?.error && (
                    <Banner tone="critical">
                        <p>{actionData.error}</p>
                    </Banner>
                )}

                <Banner tone="info">
                    <p><strong>Plan actuel :</strong> {activePlan} — {usageText}</p>
                </Banner>

                <Text variant="bodyMd" as="p" tone="subdued">
                    Choisissez le plan qui correspond le mieux à votre volume de commandes.
                </Text>

                <InlineGrid columns={{ xs: 1, sm: 2, md: 2, lg: 4 }} gap="400">
                    {planCards.map((plan) => {
                        const isCurrent = plan.key === activePlan;

                        return (
                            <Card key={plan.key}>
                                <BlockStack gap="400">
                                    <BlockStack gap="200">
                                        <InlineStack align="start" gap="200">
                                            <Text variant="headingLg" as="h2">{plan.name}</Text>
                                            {plan.badge && <Badge tone="info">{plan.badge}</Badge>}
                                            {isCurrent && <Badge tone="success">Actuel</Badge>}
                                        </InlineStack>
                                        <Text variant="bodyMd" as="p" tone="subdued">{plan.description}</Text>
                                    </BlockStack>

                                    <BlockStack gap="100">
                                        <InlineStack align="start" blockAlign="end" gap="100">
                                            <Text variant="heading2xl" as="p" fontWeight="bold">{plan.price}</Text>
                                            <Text variant="bodyMd" as="span" tone="subdued">{plan.period}</Text>
                                        </InlineStack>
                                        <Text variant="bodySm" as="p" tone="success" fontWeight="semibold">
                                            {plan.orders}
                                        </Text>
                                    </BlockStack>

                                    <Divider />

                                    <BlockStack gap="200">
                                        {plan.features.map((feature, i) => (
                                            <Text
                                                key={i}
                                                as="p"
                                                variant="bodyMd"
                                                tone={feature.included ? undefined : "subdued"}
                                            >
                                                {feature.included ? "✅" : "❌"} {feature.text}
                                            </Text>
                                        ))}
                                    </BlockStack>

                                    <Button
                                        variant={plan.highlight && !isCurrent ? "primary" : undefined}
                                        disabled={isCurrent || isSubmitting}
                                        fullWidth
                                        onClick={() => handleSelectPlan(plan.key)}
                                    >
                                        {isCurrent ? "Plan actuel" : `Choisir ${plan.name}`}
                                    </Button>
                                </BlockStack>
                            </Card>
                        );
                    })}
                </InlineGrid>
            </BlockStack>
        </Page>
    );
}
