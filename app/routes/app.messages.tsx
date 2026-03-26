import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
    Page, Layout, Card, IndexTable, Badge, useIndexResourceState, Text,
    BlockStack, InlineStack, EmptyState, Divider, Box, Icon, ProgressBar,
} from "@shopify/polaris";
import {
    ChatIcon, CheckCircleIcon, XCircleIcon, ClockIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const logs = await db.messageLog.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSent, totalFailed, totalPending] = await Promise.all([
        db.messageLog.count({ where: { shop: session.shop, status: "SENT" } }),
        db.messageLog.count({ where: { shop: session.shop, status: "FAILED" } }),
        db.messageLog.count({ where: { shop: session.shop, status: "PENDING" } }),
    ]);

    const sentThisMonth = await db.messageLog.count({
        where: { shop: session.shop, status: "SENT", createdAt: { gte: periodStart } },
    });

    return { logs, totalSent, totalFailed, totalPending, sentThisMonth };
};

export default function Messages() {
    const { logs, totalSent, totalFailed, totalPending, sentThisMonth } = useLoaderData<typeof loader>();

    const resourceName = { singular: 'message', plural: 'messages' };
    const { selectedResources, allResourcesSelected, handleSelectionChange } =
        useIndexResourceState(logs);

    const total = totalSent + totalFailed + totalPending;
    const successRate = total > 0 ? Math.round((totalSent / total) * 100) : 0;

    const statusLabel = (status: string) => {
        switch (status) {
            case 'SENT': return 'Envoyé';
            case 'FAILED': return 'Échoué';
            case 'PENDING': return 'En attente';
            default: return status;
        }
    };

    const rowMarkup = logs.map(
        ({ id, orderId, customerName, status, content, createdAt }: any, index: number) => (
            <IndexTable.Row
                id={id}
                key={id}
                selected={selectedResources.includes(id)}
                position={index}
            >
                <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                        {orderId}
                    </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <Text variant="bodyMd" as="span">{customerName}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <Badge tone={status === 'SENT' ? 'success' : status === 'FAILED' ? 'critical' : 'attention'}>
                        {statusLabel(status)}
                    </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <div style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {content}
                    </div>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <Text variant="bodyMd" as="span" tone="subdued">
                        {new Date(createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                </IndexTable.Cell>
            </IndexTable.Row>
        ),
    );

    return (
        <Page title="Messages" subtitle="Historique des messages WhatsApp envoyés">
            <BlockStack gap="500">
                <Layout>
                    <Layout.Section>
                        <BlockStack gap="500">
                            {/* Messages table */}
                            <Card roundedAbove="sm">
                                <BlockStack gap="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="200" blockAlign="center">
                                            <Icon source={ChatIcon} tone="base" />
                                            <Text as="h2" variant="headingMd">Journal des envois</Text>
                                        </InlineStack>
                                        <Badge tone="info">{`${logs.length} dernier${logs.length > 1 ? 's' : ''}`}</Badge>
                                    </InlineStack>

                                    <Divider />

                                    {logs.length === 0 ? (
                                        <EmptyState
                                            heading="Aucun message envoyé"
                                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                        >
                                            <Text as="p" variant="bodyMd" tone="subdued">
                                                Les messages envoyés via WhatsApp apparaîtront ici automatiquement.
                                            </Text>
                                        </EmptyState>
                                    ) : (
                                        <IndexTable
                                            resourceName={resourceName}
                                            itemCount={logs.length}
                                            selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                                            onSelectionChange={handleSelectionChange}
                                            headings={[
                                                { title: 'Commande' },
                                                { title: 'Client' },
                                                { title: 'Statut' },
                                                { title: 'Contenu' },
                                                { title: 'Date' },
                                            ]}
                                        >
                                            {rowMarkup}
                                        </IndexTable>
                                    )}
                                </BlockStack>
                            </Card>
                        </BlockStack>
                    </Layout.Section>

                    {/* Sidebar */}
                    <Layout.Section variant="oneThird">
                        <BlockStack gap="500">
                            {/* Stats card */}
                            <Card roundedAbove="sm">
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Statistiques</Text>
                                    <Divider />

                                    <BlockStack gap="300">
                                        <InlineStack gap="200" blockAlign="center">
                                            <Box minWidth="20px"><Icon source={CheckCircleIcon} tone="success" /></Box>
                                            <BlockStack gap="050">
                                                <Text as="p" variant="bodyMd" fontWeight="bold">{String(totalSent)} envoyés</Text>
                                                <Text as="p" variant="bodySm" tone="subdued">Total des messages livrés</Text>
                                            </BlockStack>
                                        </InlineStack>

                                        <InlineStack gap="200" blockAlign="center">
                                            <Box minWidth="20px"><Icon source={XCircleIcon} tone="critical" /></Box>
                                            <BlockStack gap="050">
                                                <Text as="p" variant="bodyMd" fontWeight="bold">{String(totalFailed)} échoués</Text>
                                                <Text as="p" variant="bodySm" tone="subdued">Messages non délivrés</Text>
                                            </BlockStack>
                                        </InlineStack>

                                        <InlineStack gap="200" blockAlign="center">
                                            <Box minWidth="20px"><Icon source={ClockIcon} tone="subdued" /></Box>
                                            <BlockStack gap="050">
                                                <Text as="p" variant="bodyMd" fontWeight="bold">{String(totalPending)} en attente</Text>
                                                <Text as="p" variant="bodySm" tone="subdued">Messages en cours d'envoi</Text>
                                            </BlockStack>
                                        </InlineStack>
                                    </BlockStack>
                                </BlockStack>
                            </Card>

                            {/* Performance card */}
                            <Card roundedAbove="sm">
                                <BlockStack gap="300">
                                    <Text as="h2" variant="headingMd">Performance</Text>
                                    <Divider />

                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="p" variant="bodyMd">Taux de succès</Text>
                                            <Text as="p" variant="bodyMd" fontWeight="bold">{`${successRate}%`}</Text>
                                        </InlineStack>
                                        <ProgressBar progress={successRate} tone={successRate >= 80 ? "primary" : successRate >= 50 ? "highlight" : "critical"} size="small" />
                                    </BlockStack>

                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="p" variant="bodyMd">Envois ce mois</Text>
                                            <Text as="p" variant="bodyMd" fontWeight="bold">{String(sentThisMonth)}</Text>
                                        </InlineStack>
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
