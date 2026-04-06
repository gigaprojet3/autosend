import { useEffect, useState, useCallback } from "react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page, Layout, Text, Card, Button, BlockStack, InlineStack, Badge, Divider,
  Spinner, Banner, Box, Thumbnail, Checkbox, EmptyState, ProgressBar, Icon, List,
} from "@shopify/polaris";
import {
  CheckCircleIcon, XCircleIcon, ChatIcon, ProductIcon, LinkIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getSessionStatus, getQrCode, initWhatsApp, clearSession, getChats, restoreSessionIfNeeded } from "../services/whatsapp.server";
import { PLAN_FREE, PLANS } from "../plans";
import db from "../db.server";

type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  profilePicUrl: string | null;
};

// We need to re-export boundary for error handling
export { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Auto-restore WhatsApp if creds exist in DB but no in-memory session
  await restoreSessionIfNeeded(shop);

  const status = await getSessionStatus(shop);
  const qr = await getQrCode(shop);

  // Also fetch DB session for other details if needed
  const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

  // Récupérer les conversations si WhatsApp est connecté
  let chats: Chat[] = [];
  if (status === 'connected') {
    try {
      chats = await getChats(shop);
    } catch (error) {
      console.error('Error fetching chats:', error);
      // Ne pas échouer le loader si on ne peut pas récupérer les chats
    }
  }

  // Récupérer les produits sélectionnés
  const selectedProducts = await db.selectedProduct.findMany({ where: { shop } });

  // ── Plan & usage data ───────────────────────────────────────────────
  const ACTIVE_SUB_QUERY = `#graphql
    query ActiveSubscription {
      currentAppInstallation {
        activeSubscriptions { id name status }
      }
    }
  `;
  let activePlan = PLAN_FREE;
  try {
    const subRes = await admin.graphql(ACTIVE_SUB_QUERY);
    const subData = await subRes.json();
    const subs = subData?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.find((s: any) => s.status === "ACTIVE");
    if (active) activePlan = active.name;
  } catch (e) {
    console.error('Error fetching subscription in index loader:', e);
  }

  const planMeta = PLANS[activePlan] ?? PLANS[PLAN_FREE];

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const orderCount = await db.messageLog.count({
    where: { shop, createdAt: { gte: periodStart } },
  });

  return {
    shop,
    status,
    qr,
    targetJid: dbSession?.targetJid,
    chats,
    selectedProducts,
    activePlan,
    orderCount,
    orderLimit: planMeta.orderLimit,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "init") {
    console.log("🚀 INIT ACTION STARTED for shop:", shop);

    // Start the socket if not started
    try {
      await initWhatsApp(shop);
    } catch (error) {
      console.error("❌ Failed to init WhatsApp in action:", error);
      return {
        success: false,
        error: "Failed to initialize WhatsApp. Check server logs."
      };
    }

    // Retourner immédiatement le statut d'initialisation
    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);
    const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

    console.log("📊 INIT ACTION STATUS:", { status, hasQr: !!qr });

    // Récupérer les conversations si WhatsApp est connecté
    let chats: Chat[] = [];
    if (status === 'connected') {
      try {
        chats = await getChats(shop);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    }

    return {
      success: true,
      shop,
      status,
      qr,
      targetJid: dbSession?.targetJid,
      chats
    };
  }

  if (intent === "disconnect") {
    // Nettoyer complètement la session WhatsApp
    await clearSession(shop);

    // Retourner les données mises à jour
    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);
    const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

    // Récupérer les conversations si WhatsApp est connecté
    let chats: Chat[] = [];
    if (status === 'connected') {
      try {
        chats = await getChats(shop);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    }

    return {
      success: true,
      shop,
      status,
      qr,
      targetJid: dbSession?.targetJid,
      chats
    };
  }

  if (intent === "clear") {
    // Forcer le nettoyage complet en cas de problème
    await clearSession(shop);

    // Retourner les données mises à jour
    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);
    const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

    // Récupérer les conversations si WhatsApp est connecté
    let chats: Chat[] = [];
    if (status === 'connected') {
      try {
        chats = await getChats(shop);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    }

    return {
      success: true,
      shop,
      status,
      qr,
      targetJid: dbSession?.targetJid,
      chats
    };
  }

  if (intent === "set_destination") {
    const targetJid = formData.get("targetJid") as string;
    if (!targetJid) {
      return { error: "Destination non valide" };
    }

    // Sauvegarder la destination en base de données
    await db.whatsAppSession.upsert({
      where: { shop },
      create: { shop, targetJid },
      update: { targetJid, updatedAt: new Date() }
    });

    // Retourner les données mises à jour
    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);
    const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

    // Récupérer les conversations si WhatsApp est connecté
    let chats: Chat[] = [];
    if (status === 'connected') {
      try {
        chats = await getChats(shop);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    }

    return {
      success: true,
      shop,
      status,
      qr,
      targetJid: dbSession?.targetJid,
      chats
    };
  }

  if (intent === "clear_destination") {
    // Supprimer la destination
    await db.whatsAppSession.update({
      where: { shop },
      data: { targetJid: null, updatedAt: new Date() }
    });

    // Retourner les données mises à jour
    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);
    const dbSession = await db.whatsAppSession.findUnique({ where: { shop } });

    // Récupérer les conversations si WhatsApp est connecté
    let chats: Chat[] = [];
    if (status === 'connected') {
      try {
        chats = await getChats(shop);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    }

    return {
      success: true,
      shop,
      status,
      qr,
      targetJid: dbSession?.targetJid,
      chats
    };
  }

  if (intent === "fetch_products") {
    // Fetch all products from Shopify store via Admin GraphQL API
    try {
      const response = await admin.graphql(`
        query {
          products(first: 250) {
            edges {
              node {
                id
                title
                featuredMedia {
                  preview {
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      `);
      const data = await response.json();
      const products = data.data.products.edges.map((edge: any) => ({
        id: edge.node.id.replace('gid://shopify/Product/', ''),
        title: edge.node.title,
        imageUrl: edge.node.featuredMedia?.preview?.image?.url || null,
      }));
      return { products };
    } catch (error) {
      console.error('Error fetching products:', error);
      return { products: [], error: 'Erreur lors de la récupération des produits' };
    }
  }

  if (intent === "save_products") {
    const productsJson = formData.get("products") as string;
    if (!productsJson) return { error: "Aucun produit fourni" };

    try {
      const products = JSON.parse(productsJson) as Array<{ id: string; title: string; imageUrl: string | null }>;

      // Remove all existing selections for this shop
      await db.selectedProduct.deleteMany({ where: { shop } });

      // Insert new selections
      if (products.length > 0) {
        await db.$transaction(
          products.map((p) =>
            db.selectedProduct.create({
              data: {
                shop,
                productId: p.id,
                title: p.title,
                imageUrl: p.imageUrl,
              },
            })
          )
        );
      }

      const selectedProducts = await db.selectedProduct.findMany({ where: { shop } });
      return { success: true, selectedProducts };
    } catch (error) {
      console.error('Error saving products:', error);
      return { error: 'Erreur lors de la sauvegarde des produits' };
    }
  }

  if (intent === "remove_product") {
    const productId = formData.get("productId") as string;
    if (!productId) return { error: "ID produit manquant" };

    try {
      await db.selectedProduct.deleteMany({ where: { shop, productId } });
      const selectedProducts = await db.selectedProduct.findMany({ where: { shop } });
      return { success: true, selectedProducts };
    } catch (error) {
      console.error('Error removing product:', error);
      return { error: 'Erreur lors de la suppression du produit' };
    }
  }

  return null;
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const waFetcher = useFetcher<typeof action>();
  const productFetcher = useFetcher<typeof action>();

  const [liveStatus, setLiveStatus] = useState(loaderData.status);
  const [liveQr, setLiveQr] = useState(loaderData.qr);

  const chats = (waFetcher.data as any)?.chats ?? loaderData.chats;
  const targetJid = (waFetcher.data as any)?.targetJid ?? loaderData.targetJid;
  const selectedProducts = (productFetcher.data as any)?.selectedProducts ?? loaderData.selectedProducts;

  const status = liveStatus;
  const qr = liveQr;
  const isConnected = status === 'connected';
  const isInitializing = status === 'initializing';
  const needsQr = status === 'needs_qr';
  const isDisconnected = status === 'disconnected' || !status;
  const waLoading = waFetcher.state !== "idle";
  const waIntent = waLoading ? (waFetcher.formData?.get("intent") as string | null) : null;
  const prodLoading = productFetcher.state !== "idle";

  const orderCountFetcher = useFetcher<{ orderCount: number }>();
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [shopProducts, setShopProducts] = useState<Array<{ id: string; title: string; imageUrl: string | null }>>([]);
  const [checkedProducts, setCheckedProducts] = useState<Set<string>>(new Set());
  const [productsLoading, setProductsLoading] = useState(false);

  useEffect(() => {
    const data = waFetcher.data as any;
    if (data?.status) setLiveStatus(data.status);
    if (data?.qr !== undefined) setLiveQr(data.qr ?? undefined);
  }, [waFetcher.data]);

  useEffect(() => {
    const data = productFetcher.data as any;
    if (data?.products) {
      setShopProducts(data.products);
      const alreadySelected = new Set<string>(
        (data.selectedProducts ?? selectedProducts ?? []).map((p: any) => p.productId as string)
      );
      setCheckedProducts(alreadySelected);
      setProductsLoading(false);
    }
  }, [productFetcher.data]);

  // ── Fast poll (1 s) while not yet connected — updates WA status + QR ──
  useEffect(() => {
    if (isConnected) return;
    const controller = new AbortController();
    const shop = loaderData.shop;
    let timeoutId: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/whatsapp/status?shop=${encodeURIComponent(shop)}`, { signal: controller.signal });
        if (res.ok && !controller.signal.aborted) {
          const data = await res.json() as { status: string; qr: string | null };
          setLiveStatus(data.status as any);
          setLiveQr(data.qr ?? undefined);
        }
      } catch { /* ignore */ }
      if (!controller.signal.aborted) timeoutId = setTimeout(poll, 1000);
    };
    timeoutId = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [isConnected]);

  // ── Order count refresh (15 s) via useFetcher — fires immediately ──
  useEffect(() => {
    const shop = loaderData.shop;
    const refresh = () => orderCountFetcher.load(`/api/order-count?shop=${encodeURIComponent(shop)}`);
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [loaderData.shop]);

  const step1Done = isConnected;
  const step2Done = !!targetJid;
  const step3Done = selectedProducts.length > 0;
  const stepsComplete = [step1Done, step2Done, step3Done].filter(Boolean).length;
  const allDone = stepsComplete === 3;

  const { activePlan, orderLimit } = loaderData;
  const liveOrderCount = (orderCountFetcher.data as any)?.orderCount ?? loaderData.orderCount;
  const usagePercent = orderLimit !== null ? Math.min(100, Math.round((liveOrderCount / orderLimit) * 100)) : 0;
  const isNearLimit = orderLimit !== null && usagePercent >= 80;

  const handleOpenSelector = useCallback(() => {
    if (!showProductSelector) {
      setProductsLoading(true);
      setShowProductSelector(true);
      productFetcher.submit({ intent: 'fetch_products' }, { method: 'POST' });
    } else {
      setShowProductSelector(false);
    }
  }, [showProductSelector, productFetcher]);

  const handleSaveProducts = useCallback(() => {
    const productsToSave = shopProducts
      .filter((p) => checkedProducts.has(p.id))
      .map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl }));
    productFetcher.submit(
      { intent: 'save_products', products: JSON.stringify(productsToSave) },
      { method: 'POST' }
    );
    setShowProductSelector(false);
  }, [shopProducts, checkedProducts, productFetcher]);

  // ── Shared avatar component ─────────────────────────────────────
  const Avatar = ({ src, fallback, size = 40 }: { src?: string | null; fallback: string; size?: number }) => (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      backgroundColor: 'var(--p-color-bg-surface-secondary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: size * 0.45, color: 'var(--p-color-text-secondary)' }}>{fallback}</span>
      )}
    </div>
  );

  return (
    <Page title="Autosend" subtitle="Envoi automatique de commandes via WhatsApp">
      <BlockStack gap="500">

        {/* ── Progress banner ──────────────────────────────────────── */}
        {!allDone ? (
          <Banner tone="warning" title={`Configuration : ${stepsComplete} sur 3 étapes complétées`}>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Complétez les étapes ci-dessous pour activer l'envoi automatique.
              </Text>
              <ProgressBar progress={(stepsComplete / 3) * 100} tone="primary" size="small" />
            </BlockStack>
          </Banner>
        ) : (
          <Card roundedAbove="sm">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="h2" variant="headingMd">{`Plan ${activePlan}`}</Text>
                </InlineStack>
                <Badge tone="success">Actif</Badge>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Commandes ce mois</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {orderLimit !== null
                      ? `${liveOrderCount} / ${orderLimit}`
                      : `${liveOrderCount} (illimité)`
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
                {isNearLimit ? (
                  <Text as="p" variant="bodySm" tone="critical">
                    {`Attention : ${usagePercent}% de votre quota utilisé. Pensez à passer au plan supérieur.`}
                  </Text>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Les nouvelles commandes sont envoyées automatiquement sur WhatsApp.
                  </Text>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        <Layout>
          {/* ── Main column ────────────────────────────────────────── */}
          <Layout.Section>
            <BlockStack gap="500">

              {/* ── Card 1 : WhatsApp ──────────────────────────────── */}
              <Card roundedAbove="sm">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={LinkIcon} tone="base" />
                      <Text as="h2" variant="headingMd">Connexion WhatsApp</Text>
                    </InlineStack>
                    <Badge tone={isConnected ? "success" : isInitializing || needsQr ? "attention" : "critical"}>
                      {isConnected ? 'Connecté' : isInitializing ? 'Initialisation' : needsQr ? 'QR Code prêt' : 'Déconnecté'}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  {/* QR Code */}
                  {(needsQr || (isInitializing && qr)) && !isConnected && (
                    <BlockStack gap="300" inlineAlign="center">
                      <Box background="bg-surface-secondary" padding="400" borderRadius="300">
                        {qr && <img src={qr} alt="WhatsApp QR Code" style={{ width: 240, height: 240, display: 'block', borderRadius: '8px' }} />}
                      </Box>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Ouvrez WhatsApp &gt; Appareils liés &gt; Scannez ce code
                      </Text>
                    </BlockStack>
                  )}

                  {/* Loading QR */}
                  {isInitializing && !qr && (
                    <Box padding="800">
                      <BlockStack gap="300" inlineAlign="center">
                        <Spinner size="large" />
                        <Text as="p" tone="subdued" alignment="center">Génération du QR code...</Text>
                      </BlockStack>
                    </Box>
                  )}

                  {/* Disconnected */}
                  {isDisconnected && !qr && !isInitializing && (
                    <BlockStack gap="300">
                      <Text as="p" variant="bodyMd">
                        Connectez votre compte WhatsApp pour commencer à envoyer les commandes automatiquement.
                      </Text>
                      <InlineStack gap="200">
                        <Button variant="primary" onClick={() => waFetcher.submit({ intent: 'init' }, { method: "POST" })} loading={waIntent === 'init'}>
                          Connecter WhatsApp
                        </Button>
                        <Button variant="plain" tone="critical" onClick={() => waFetcher.submit({ intent: 'clear' }, { method: "POST" })} loading={waIntent === 'clear'}>
                          Réinitialiser la session
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}

                  {/* Connected */}
                  {isConnected && (
                    <BlockStack gap="300">
                      <Box background="bg-surface-success" padding="300" borderRadius="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="p" variant="bodyMd" fontWeight="semibold">WhatsApp est connecté et prêt.</Text>
                        </InlineStack>
                      </Box>
                      <div>
                        <Button tone="critical" onClick={() => waFetcher.submit({ intent: 'disconnect' }, { method: "POST" })} loading={waIntent === 'disconnect'}>
                          Déconnecter WhatsApp
                        </Button>
                      </div>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* ── Card 2 : Destination ───────────────────────────── */}
              {isConnected && (
                <Card roundedAbove="sm">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={ChatIcon} tone="base" />
                        <Text as="h2" variant="headingMd">Destination des messages</Text>
                      </InlineStack>
                      {step2Done && <Badge tone="success">Configuré</Badge>}
                    </InlineStack>

                    <Divider />

                    {targetJid ? (
                      <BlockStack gap="300">
                        {(() => {
                          const sel = chats.find((c: Chat) => c.id === targetJid);
                          return (
                            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                              <InlineStack gap="300" blockAlign="center">
                                <Avatar src={sel?.profilePicUrl} fallback={sel?.isGroup ? '👥' : '👤'} size={44} />
                                <BlockStack gap="050">
                                  <Text as="p" variant="bodyMd" fontWeight="bold">{sel?.name || targetJid}</Text>
                                  {sel?.isGroup && <Badge tone="info" size="small">Groupe</Badge>}
                                </BlockStack>
                              </InlineStack>
                            </Box>
                          );
                        })()}
                        <div>
                          <Button variant="plain" onClick={() => waFetcher.submit({ intent: 'clear_destination' }, { method: "POST" })} loading={waIntent === 'clear_destination'}>
                            Modifier la destination
                          </Button>
                        </div>
                      </BlockStack>
                    ) : (
                      <BlockStack gap="300">
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Choisissez le groupe ou contact qui recevra les notifications de commandes.
                        </Text>

                        {waLoading && chats.length === 0 ? (
                          <Box padding="600">
                            <BlockStack gap="200" inlineAlign="center">
                              <Spinner size="small" />
                              <Text as="p" tone="subdued">Chargement des conversations...</Text>
                            </BlockStack>
                          </Box>
                        ) : chats.length > 0 ? (
                          <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--p-color-border)', borderRadius: 'var(--p-border-radius-200)' }}>
                            {chats.map((chat: Chat, idx: number) => (
                              <div key={chat.id}>
                                <button
                                  type="button"
                                  onClick={() => waFetcher.submit({ intent: 'set_destination', targetJid: chat.id }, { method: "POST" })}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    padding: '10px 16px', border: 'none', backgroundColor: 'transparent',
                                    cursor: 'pointer', width: '100%', textAlign: 'left',
                                    transition: 'background-color 0.15s',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--p-color-bg-surface-hover)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                >
                                  <Avatar src={chat.profilePicUrl} fallback={chat.isGroup ? '👥' : '👤'} size={40} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <Text as="p" variant="bodyMd" fontWeight="semibold" truncate>{chat.name}</Text>
                                    <InlineStack gap="100">
                                      {chat.isGroup && <Badge tone="info" size="small">Groupe</Badge>}
                                      {chat.unreadCount > 0 && <Badge tone="attention" size="small">{`${String(chat.unreadCount)} non lus`}</Badge>}
                                    </InlineStack>
                                  </div>
                                </button>
                                {idx < chats.length - 1 && <Divider />}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Box padding="400">
                            <BlockStack gap="200" inlineAlign="center">
                              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                                Aucun groupe trouvé. Envoyez un message dans un groupe WhatsApp puis actualisez.
                              </Text>
                              <Button onClick={() => waFetcher.load("/app")} loading={waIntent === null && waLoading}>Actualiser</Button>
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* ── Card 3 : Produits ──────────────────────────────── */}
              <Card roundedAbove="sm">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={ProductIcon} tone="base" />
                      <Text as="h2" variant="headingMd">Produits suivis</Text>
                    </InlineStack>
                    {step3Done && <Badge tone="success">{`${selectedProducts.length} actif${selectedProducts.length > 1 ? 's' : ''}`}</Badge>}
                  </InlineStack>

                  <Divider />

                  <Text as="p" variant="bodyMd" tone="subdued">
                    Seules les commandes contenant un produit sélectionné déclencheront un envoi WhatsApp.
                  </Text>

                  {!step3Done && (
                    <Banner tone="warning">
                      <Text as="p" variant="bodyMd">
                        Aucun produit sélectionné — l'envoi automatique est désactivé.
                      </Text>
                    </Banner>
                  )}

                  {/* Selected products list */}
                  {selectedProducts.length > 0 && (
                    <div style={{ border: '1px solid var(--p-color-border)', borderRadius: 'var(--p-border-radius-200)' }}>
                      {selectedProducts.map((product: any, idx: number) => (
                        <div key={product.productId}>
                          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Thumbnail
                              source={product.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png"}
                              alt={product.title}
                              size="small"
                            />
                            <div style={{ flex: 1 }}>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{product.title}</Text>
                            </div>
                            <Button variant="plain" tone="critical" onClick={() => productFetcher.submit({ intent: 'remove_product', productId: product.productId }, { method: 'POST' })}>
                              Retirer
                            </Button>
                          </div>
                          {idx < selectedProducts.length - 1 && <Divider />}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Selector button */}
                  <div>
                    <Button
                      variant={step3Done ? "secondary" : "primary"}
                      onClick={handleOpenSelector}
                      loading={productsLoading}
                      icon={ProductIcon}
                    >
                      {showProductSelector ? 'Fermer' : step3Done ? 'Modifier la sélection' : 'Sélectionner des produits'}
                    </Button>
                  </div>

                  {/* Product selector dropdown */}
                  {showProductSelector && (
                    <BlockStack gap="300">
                      {productsLoading ? (
                        <Box padding="600">
                          <BlockStack gap="200" inlineAlign="center">
                            <Spinner size="small" />
                            <Text as="p" tone="subdued">Chargement des produits...</Text>
                          </BlockStack>
                        </Box>
                      ) : shopProducts.length > 0 ? (
                        <>
                          <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--p-color-border)', borderRadius: 'var(--p-border-radius-200)' }}>
                            {shopProducts.map((product, idx) => {
                              const isChecked = checkedProducts.has(product.id);
                              return (
                                <div key={product.id}>
                                  <div
                                    style={{
                                      padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                                      backgroundColor: isChecked ? 'var(--p-color-bg-surface-success)' : 'transparent',
                                      cursor: 'pointer', transition: 'background-color 0.15s',
                                    }}
                                    onClick={() => {
                                      setCheckedProducts((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(product.id)) next.delete(product.id);
                                        else next.add(product.id);
                                        return next;
                                      });
                                    }}
                                    onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'var(--p-color-bg-surface-hover)'; }}
                                    onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    <Checkbox label="" labelHidden checked={isChecked} onChange={() => {
                                      setCheckedProducts((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(product.id)) next.delete(product.id);
                                        else next.add(product.id);
                                        return next;
                                      });
                                    }} />
                                    <Thumbnail
                                      source={product.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png"}
                                      alt={product.title}
                                      size="small"
                                    />
                                    <Text as="p" variant="bodyMd" fontWeight={isChecked ? "bold" : "regular"}>{product.title}</Text>
                                  </div>
                                  {idx < shopProducts.length - 1 && <Divider />}
                                </div>
                              );
                            })}
                          </div>
                          <InlineStack align="end" gap="200">
                            <Button onClick={() => setShowProductSelector(false)}>Annuler</Button>
                            <Button variant="primary" onClick={handleSaveProducts} disabled={checkedProducts.size === 0}>
                              Enregistrer ({String(checkedProducts.size)} produit{checkedProducts.size > 1 ? 's' : ''})
                            </Button>
                          </InlineStack>
                        </>
                      ) : (
                        <Box padding="400">
                          <Text as="p" tone="subdued" alignment="center">Aucun produit dans votre boutique.</Text>
                        </Box>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>

          {/* ── Sidebar ────────────────────────────────────────────── */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">

              {/* Setup checklist */}
              <Card roundedAbove="sm">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Guide de configuration</Text>
                  <Divider />
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="start">
                      <Box minWidth="20px"><Icon source={step1Done ? CheckCircleIcon : XCircleIcon} tone={step1Done ? "success" : "subdued"} /></Box>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight={step1Done ? "bold" : "regular"}>
                          {step1Done ? 'WhatsApp connecté' : 'Connecter WhatsApp'}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Scannez le QR code depuis votre téléphone.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="start">
                      <Box minWidth="20px"><Icon source={step2Done ? CheckCircleIcon : XCircleIcon} tone={step2Done ? "success" : "subdued"} /></Box>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight={step2Done ? "bold" : "regular"}>
                          {step2Done ? 'Destination configurée' : 'Choisir une destination'}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Groupe ou contact qui recevra les commandes.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="start">
                      <Box minWidth="20px"><Icon source={step3Done ? CheckCircleIcon : XCircleIcon} tone={step3Done ? "success" : "subdued"} /></Box>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight={step3Done ? "bold" : "regular"}>
                          {step3Done ? `${selectedProducts.length} produit${selectedProducts.length > 1 ? 's' : ''} sélectionné${selectedProducts.length > 1 ? 's' : ''}` : 'Sélectionner des produits'}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Filtrez quels produits déclenchent un envoi.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* How it works */}
              <Card roundedAbove="sm">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Comment ça marche</Text>
                  <Divider />
                  <List type="number">
                    <List.Item>Un client passe commande sur votre boutique Shopify.</List.Item>
                    <List.Item>Autosend vérifie si la commande contient un produit suivi.</List.Item>
                    <List.Item>Le message est envoyé automatiquement sur WhatsApp.</List.Item>
                  </List>
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
