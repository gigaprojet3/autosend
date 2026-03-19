import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
    Page,
    Card,
    IndexTable,
    Badge,
    useIndexResourceState,
    Text,
    BlockStack,
    EmptyState
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    const logs = await db.messageLog.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    return { logs };
};

export default function Messages() {
    const { logs } = useLoaderData<typeof loader>();

    const resourceName = {
        singular: 'message',
        plural: 'messages',
    };

    const { selectedResources, allResourcesSelected, handleSelectionChange } =
        useIndexResourceState(logs);

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
                <IndexTable.Cell>{customerName}</IndexTable.Cell>
                <IndexTable.Cell>
                    <Badge tone={status === 'SENT' ? 'success' : status === 'FAILED' ? 'critical' : 'attention'}>
                        {status}
                    </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <div style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {content}
                    </div>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    {new Date(createdAt).toLocaleString()}
                </IndexTable.Cell>
            </IndexTable.Row>
        ),
    );

    return (
        <Page title="Messages & Logs">
            <Card>
                {logs.length === 0 ? (
                    <EmptyState
                        heading="Aucun message envoyé"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                        <p>Les messages envoyés apparaîtront ici.</p>
                    </EmptyState>
                ) : (
                    <IndexTable
                        resourceName={resourceName}
                        itemCount={logs.length}
                        selectedItemsCount={
                            allResourcesSelected ? 'All' : selectedResources.length
                        }
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
            </Card>
        </Page>
    );
}
