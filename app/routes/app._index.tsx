import { useEffect, useState, useRef } from "react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Page, Layout, Text, Card, Button, BlockStack, Badge, Divider, Spinner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSessionStatus, getQrCode, initWhatsApp, clearSession, getChats } from "../services/whatsapp.server";
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

  return {
    shop,
    status,
    qr,
    targetJid: dbSession?.targetJid,
    chats,
    selectedProducts,
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
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // Live state for status and QR (kept up to date by polling)
  const [liveStatus, setLiveStatus] = useState(loaderData.status);
  const [liveQr, setLiveQr] = useState(loaderData.qr);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Merge fetcher action data with loader/live data
  const chats = (fetcher.data as any)?.chats ?? loaderData.chats;
  const targetJid = (fetcher.data as any)?.targetJid ?? loaderData.targetJid;
  const selectedProducts = (fetcher.data as any)?.selectedProducts ?? loaderData.selectedProducts;

  const status = liveStatus;
  const qr = liveQr;

  const isConnected = status === 'connected';
  const isInitializing = status === 'initializing';
  const needsQr = status === 'needs_qr';
  const isDisconnected = status === 'disconnected' || !status;
  const isLoading = fetcher.state !== "idle";

  // Product selector state
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [shopProducts, setShopProducts] = useState<Array<{ id: string; title: string; imageUrl: string | null }>>([]);
  const [checkedProducts, setCheckedProducts] = useState<Set<string>>(new Set());
  const [productsLoading, setProductsLoading] = useState(false);

  // When action returns, sync live state
  useEffect(() => {
    const data = fetcher.data as any;
    if (data?.status) {
      setLiveStatus(data.status);
    }
    if (data?.qr !== undefined) {
      setLiveQr(data.qr ?? undefined);
    }
    // Handle fetched products from Shopify
    if (data?.products) {
      setShopProducts(data.products);
      // Pre-check already selected products
      const alreadySelected = new Set<string>(
        (data.selectedProducts ?? selectedProducts ?? []).map((p: any) => p.productId as string)
      );
      setCheckedProducts(alreadySelected);
      setProductsLoading(false);
    }
  }, [fetcher.data]);

  // Poll /api/whatsapp/status every second while not connected
  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (isConnected) return;

    const shop = loaderData.shop;
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/whatsapp/status?shop=${encodeURIComponent(shop)}`);
        if (res.ok) {
          const data = await res.json() as { status: string; qr: string | null };
          setLiveStatus(data.status as any);
          setLiveQr(data.qr ?? undefined);
        }
      } catch {
        // ignore network errors during polling
      }
    }, 1000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isConnected]);

  return (
    <Page title="Autosend">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text as="h2" variant="headingMd">
                Connexion WhatsApp
              </Text>

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Statut: <Text as="span" fontWeight="bold" tone={isConnected ? "success" : "critical"}>
                    {isConnected ? '🟢 Connecté' :
                      isInitializing ? '🟡 Initialisation...' :
                        needsQr ? '🟡 Scannez le QR Code' :
                          '🔴 Déconnecté'}
                  </Text>
                </Text>

                {(needsQr || (isInitializing && qr)) && !isConnected && (
                  <BlockStack gap="400" align="center" inlineAlign="center">
                    <div style={{ backgroundColor: '#f1f1f1', padding: '20px', borderRadius: '8px' }}>
                      {qr && <img src={qr} alt="Scan me" style={{ width: 250, height: 250, display: 'block' }} />}
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Scannez ce QR Code avec WhatsApp (Appareils liés)
                    </Text>
                  </BlockStack>
                )}

                {isInitializing && !qr && (
                  <BlockStack gap="400" align="center" inlineAlign="center">
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                      <Text as="p" tone="subdued">Génération du code QR en cours...</Text>
                    </div>
                  </BlockStack>
                )}

                {isDisconnected && !qr && !isInitializing && (
                  <BlockStack gap="200">
                    <Text as="p">
                      Cliquez ci-dessous pour générer un QR Code de connexion.
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => fetcher.submit({ intent: 'init' }, { method: "POST" })}
                      loading={isLoading}
                    >
                      Connecter WhatsApp
                    </Button>
                    <Text as="p" tone="subdued">
                      Si la connexion échoue, essayez de nettoyer la session :
                    </Text>
                    <Button
                      variant="secondary"
                      onClick={() => fetcher.submit({ intent: 'clear' }, { method: "POST" })}
                      loading={isLoading}
                    >
                      🧹 Nettoyer la session
                    </Button>
                  </BlockStack>
                )}

                {isConnected && (
                  <Button
                    variant="primary"
                    tone="critical"
                    onClick={() => fetcher.submit({ intent: 'disconnect' }, { method: "POST" })}
                    loading={isLoading}
                  >
                    Déconnecter
                  </Button>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Section de sélection de destination - seulement si connecté */}
        {isConnected && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  📱 Destination des commandes
                </Text>

                {targetJid ? (
                  <BlockStack gap="200">
                    <Text as="p">
                      <Text as="span" tone="success">✅ Destination configurée:</Text>
                    </Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: '#f6f6f7', borderRadius: '8px' }}>
                      {(() => {
                        const selected = chats.find((chat: Chat) => chat.id === targetJid);
                        return (
                          <>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, backgroundColor: '#e1e1e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {selected?.profilePicUrl ? (
                                <img src={selected.profilePicUrl} alt={selected.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: '20px', color: '#8c9196' }}>{selected?.isGroup ? '👥' : '👤'}</span>
                              )}
                            </div>
                            <div>
                              <Text as="p" fontWeight="bold">{selected?.name || targetJid}</Text>
                              {selected?.isGroup && <Badge tone="info">Groupe</Badge>}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <Button
                      variant="plain"
                      onClick={() => fetcher.submit({ intent: 'clear_destination' }, { method: "POST" })}
                      loading={isLoading}
                    >
                      Changer la destination
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued">
                      Sélectionnez la conversation où les nouvelles commandes seront envoyées automatiquement :
                    </Text>

                    {isLoading && chats.length === 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '24px', justifyContent: 'center' }}>
                        <Spinner size="small" />
                        <Text as="p" tone="subdued">
                          Chargement des groupes WhatsApp en cours, veuillez patienter pour sélectionner le groupe destinataire...
                        </Text>
                      </div>
                    ) : chats.length > 0 ? (
                      <div style={{
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        scrollBehavior: 'smooth',
                        paddingRight: '4px',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {chats.map((chat: Chat) => (
                            <button
                              key={chat.id}
                              type="button"
                              onClick={() => {
                                fetcher.submit(
                                  { intent: 'set_destination', targetJid: chat.id },
                                  { method: "POST" }
                                );
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px 12px',
                                border: 'none',
                                borderRadius: '8px',
                                backgroundColor: 'transparent',
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                                transition: 'background-color 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f1f1')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, backgroundColor: '#e1e1e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {chat.profilePicUrl ? (
                                  <img src={chat.profilePicUrl} alt={chat.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <span style={{ fontSize: '18px', color: '#8c9196' }}>{chat.isGroup ? '👥' : '👤'}</span>
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '14px', color: '#202223', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {chat.name}
                                </div>
                                <div style={{ fontSize: '12px', color: '#6d7175', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  {chat.isGroup && <Badge tone="info">Groupe</Badge>}
                                  {chat.unreadCount > 0 && <Badge tone="attention">{`${String(chat.unreadCount)} non lus`}</Badge>}
                                  {!chat.isGroup && <span>{chat.id.replace('@s.whatsapp.net', '')}</span>}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <BlockStack gap="200">
                        <Text as="p" tone="subdued">
                          Aucune conversation trouvée. Voici les solutions possibles :
                        </Text>
                        <BlockStack gap="100">
                          <Text as="p" tone="subdued">• Envoyez un message sur WhatsApp pour créer des conversations</Text>
                          <Text as="p" tone="subdued">• Actualisez cette page après avoir envoyé des messages</Text>
                          <Text as="p" tone="subdued">• Vérifiez que votre WhatsApp est bien connecté</Text>
                        </BlockStack>
                        <Button
                          variant="secondary"
                          onClick={() => fetcher.load("/app")}
                          loading={isLoading}
                        >
                          🔄 Actualiser les conversations
                        </Button>
                      </BlockStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Section de sélection des produits — obligatoire */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                🛒 Produits suivis
              </Text>

              <Text as="p" tone="subdued">
                Sélectionnez les produits dont les commandes déclencheront un envoi automatique sur WhatsApp.
                Les commandes contenant uniquement des produits non sélectionnés ne seront pas envoyées.
              </Text>

              {selectedProducts.length === 0 && (
                <div style={{ padding: '12px', backgroundColor: '#fff3cd', borderRadius: '8px', border: '1px solid #ffc107' }}>
                  <Text as="p" fontWeight="bold" tone="caution">
                    ⚠️ Aucun produit sélectionné — les envois automatiques sont désactivés.
                  </Text>
                  <Text as="p" tone="subdued">
                    Vous devez sélectionner au moins un produit pour activer l'envoi automatique des commandes.
                  </Text>
                </div>
              )}

              {/* Afficher les produits déjà sélectionnés */}
              {selectedProducts.length > 0 && (
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">
                    {selectedProducts.length} produit{selectedProducts.length > 1 ? 's' : ''} sélectionné{selectedProducts.length > 1 ? 's' : ''} :
                  </Text>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {selectedProducts.map((product: any) => (
                      <div
                        key={product.productId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 12px',
                          borderBottom: '1px solid #e1e3e5',
                        }}
                      >
                        <div style={{ width: 36, height: 36, borderRadius: '6px', overflow: 'hidden', flexShrink: 0, backgroundColor: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: '16px' }}>📦</span>
                          )}
                        </div>
                        <div style={{ flex: 1, fontSize: '14px', color: '#202223' }}>{product.title}</div>
                        <button
                          type="button"
                          onClick={() => {
                            fetcher.submit(
                              { intent: 'remove_product', productId: product.productId },
                              { method: 'POST' }
                            );
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#bf0711',
                            fontSize: '13px',
                            padding: '4px 8px',
                          }}
                        >
                          ✕ Retirer
                        </button>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              )}

              {/* Bouton pour ouvrir/fermer le sélecteur */}
              <Button
                variant="secondary"
                onClick={() => {
                  if (!showProductSelector) {
                    setProductsLoading(true);
                    setShowProductSelector(true);
                    fetcher.submit({ intent: 'fetch_products' }, { method: 'POST' });
                  } else {
                    setShowProductSelector(false);
                  }
                }}
                loading={productsLoading}
              >
                {showProductSelector ? '▲ Fermer la liste des produits' : '▼ Sélectionner des produits'}
              </Button>

              {/* Liste déroulante des produits */}
              {showProductSelector && (
                <BlockStack gap="300">
                  {productsLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px', justifyContent: 'center' }}>
                      <Spinner size="small" />
                      <Text as="p" tone="subdued">Chargement des produits de votre boutique...</Text>
                    </div>
                  ) : shopProducts.length > 0 ? (
                    <>
                      <div style={{
                        maxHeight: '50vh',
                        overflowY: 'auto',
                        border: '1px solid #e1e3e5',
                        borderRadius: '8px',
                      }}>
                        {shopProducts.map((product) => {
                          const isChecked = checkedProducts.has(product.id);
                          return (
                            <label
                              key={product.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '10px 14px',
                                cursor: 'pointer',
                                borderBottom: '1px solid #f1f1f1',
                                backgroundColor: isChecked ? '#f0fdf4' : 'transparent',
                                transition: 'background-color 0.15s ease',
                              }}
                              onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = '#f6f6f7'; }}
                              onMouseLeave={(e) => { if (!isChecked) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setCheckedProducts((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(product.id)) {
                                      next.delete(product.id);
                                    } else {
                                      next.add(product.id);
                                    }
                                    return next;
                                  });
                                }}
                                style={{ width: 18, height: 18, cursor: 'pointer' }}
                              />
                              <div style={{ width: 40, height: 40, borderRadius: '6px', overflow: 'hidden', flexShrink: 0, backgroundColor: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {product.imageUrl ? (
                                  <img src={product.imageUrl} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <span style={{ fontSize: '18px' }}>📦</span>
                                )}
                              </div>
                              <div style={{ flex: 1, fontSize: '14px', color: '#202223', fontWeight: isChecked ? 600 : 400 }}>
                                {product.title}
                              </div>
                              {isChecked && <Badge tone="success">Sélectionné</Badge>}
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <Button
                          variant="primary"
                          onClick={() => {
                            const productsToSave = shopProducts
                              .filter((p) => checkedProducts.has(p.id))
                              .map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl }));
                            fetcher.submit(
                              { intent: 'save_products', products: JSON.stringify(productsToSave) },
                              { method: 'POST' }
                            );
                            setShowProductSelector(false);
                          }}
                          disabled={checkedProducts.size === 0}
                        >
                          Enregistrer la sélection ({String(checkedProducts.size)} produit{checkedProducts.size > 1 ? 's' : ''})
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Text as="p" tone="subdued">Aucun produit trouvé dans votre boutique.</Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Test</Text>
              <Text as="p">
                Une fois connecté, les nouvelles commandes seront envoyées automatiquement.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
