import { Page, Card, Text, BlockStack, Button, Grid, Box } from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: any) {
    await authenticate.admin(request);
    return null;
}

export default function Pricing() {
    return (
        <Page title="Plan d'abonnement">
            <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingLg" as="h2">Gratuit</Text>
                            <Text variant="bodyMd" as="p">Pour tester l'application.</Text>
                            <Text variant="heading3xl" as="p">$0.00 / mois</Text>
                            <BlockStack gap="200">
                                <Text as="p">✅ 10 commandes / mois</Text>
                                <Text as="p">✅ Support basique</Text>
                                <Text as="p" tone="subdued">❌ Groupes WhatsApp</Text>
                            </BlockStack>
                            <Button disabled>Plan actuel</Button>
                        </BlockStack>
                    </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingLg" as="h2">Premium</Text>
                            <Text variant="bodyMd" as="p">Pour les boutiques en croissance.</Text>
                            <Text variant="heading3xl" as="p">$14.95 / mois</Text>
                            <BlockStack gap="200">
                                <Text as="p">✅ Commandes illimitées</Text>
                                <Text as="p">✅ Support prioritaire</Text>
                                <Text as="p">✅ Envoi vers Groupes</Text>
                                <Text as="p">✅ Historique complet</Text>
                            </BlockStack>
                            <Button variant="primary">Passer au Premium</Button>
                        </BlockStack>
                    </Card>
                </Grid.Cell>
            </Grid>
        </Page>
    );
}
