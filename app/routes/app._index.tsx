import { useEffect, useState, useRef } from "react";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Page, Layout, Text, Card, Button, BlockStack, ChoiceList, Badge, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getSessionStatus, getQrCode, initWhatsApp, clearSession, getChats } from "../services/whatsapp.server";
import db from "../db.server";

type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
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

  return {
    shop,
    status,
    qr,
    targetJid: dbSession?.targetJid,
    chats
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  const status = liveStatus;
  const qr = liveQr;

  const isConnected = status === 'connected';
  const isInitializing = status === 'initializing';
  const needsQr = status === 'needs_qr';
  const isDisconnected = status === 'disconnected' || !status;
  const isLoading = fetcher.state !== "idle";

  // When action returns, sync live state
  useEffect(() => {
    const data = fetcher.data as any;
    if (data?.status) {
      setLiveStatus(data.status);
    }
    if (data?.qr !== undefined) {
      setLiveQr(data.qr ?? undefined);
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
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="bold">
                          {chats.find(chat => chat.id === targetJid)?.name || targetJid}
                        </Text>
                        {chats.find(chat => chat.id === targetJid)?.isGroup && (
                          <Badge tone="info">Groupe</Badge>
                        )}
                      </BlockStack>
                    </Card>
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

                    {chats.length > 0 ? (
                      <ChoiceList
                        title="Conversations disponibles"
                        choices={chats.map(chat => ({
                          label: `${chat.name}${chat.isGroup ? ' (Groupe)' : ''}`,
                          value: chat.id,
                          renderChildren: () => (
                            <BlockStack gap="100">
                              {chat.isGroup && <Badge tone="info">Groupe</Badge>}
                              {chat.unreadCount > 0 && (
                                <Badge tone="attention">{`${String(chat.unreadCount)} non lus`}</Badge>
                              )}
                            </BlockStack>
                          )
                        }))}
                        selected={targetJid ? [targetJid] : []}
                        onChange={(selected) => {
                          if (selected.length > 0) {
                            fetcher.submit(
                              { intent: 'set_destination', targetJid: selected[0] },
                              { method: "POST" }
                            );
                          }
                        }}
                      />
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
