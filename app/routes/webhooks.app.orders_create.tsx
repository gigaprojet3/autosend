import type { ActionFunctionArgs } from "react-router"; // Updated import
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendMessage, getSessionStatus } from "../services/whatsapp.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    if (!admin) {
        // The topic was valid, but there was no active session for this shop used to register webhooks.
        // This can happen if the offline session expires.
        return new Response();
    }

    // Payload is an Order resource
    const order = payload as any;

    console.log(`Received ${topic} webhook for ${shop}`);

    // 1. Check if order contains at least one selected product
    const selectedProducts = await db.selectedProduct.findMany({ where: { shop } });

    if (selectedProducts.length === 0) {
        console.log(`⏭️ No products configured for ${shop} — skipping WhatsApp send`);
        return new Response();
    }
            
    const selectedProductIds = new Set(selectedProducts.map((p) => p.productId));

    // Check if any line item's product_id matches a selected product
    const matchingItems = order.line_items.filter((item: any) =>
        selectedProductIds.has(String(item.product_id))
    );

    if (matchingItems.length === 0) {
        console.log(`⏭️ Order ${order.name} has no matching selected products — skipping WhatsApp send`);
        return new Response();
    }

    console.log(`✅ Order ${order.name} matches ${matchingItems.length} selected product(s) — sending to WhatsApp`);

    // 2. Format Message (only include matching products)
    const itemsList = matchingItems.map((item: any) => {
        return `${item.quantity}x ${item.name}`;
    }).join('\n');

    const address = order.shipping_address
        ? `${order.shipping_address.city}, ${order.shipping_address.country}`
        : 'N/A';

    const message = `📦 Nouvelle Commande ${order.name}
👤 Client : ${order.customer?.first_name} ${order.customer?.last_name || ''}
🛒 Articles :
${itemsList}
💰 Total : ${order.total_price} ${order.currency}
📍 Addresse : ${address}`;

    // 3. Send Message
    // We need to know WHO to send to.
    // The user requirement says: "Configuration du destinataire en sélectionnant une conversation/groupe"
    // We haven't implemented that configuration yet!
    // We need to store 'targetJid' (Jabber ID for WhatsApp) in the database.
    // For MVP, let's send it to the CONNECTED phone (Self) or just log it if no target set.
    // Wait, "to a specific conversation or group".
    // I need to add 'targetJid' to WhatsAppSession or a Settings table.
    // Let's assume we store it in WhatsAppSession for now for simplicity, or just hardcode/default to 'me' ID if possible?
    // Sending to 'me' (myself) is possible in WhatsApp.

    // Let's look up the session to get the targetJid
    const whatsappSession = await db.whatsAppSession.findUnique({ where: { shop } });

    // We need to add 'targetJid' to the schema!
    // I'll add a Todo to update schema. For now, let's log.

    let status = 'FAILED';
    let error = null;

    try {
        // Assuming we have a configured recipient. 
        // If NOT, maybe we send to the own number? 
        // Baileys: sock.sendMessage(sock.user.id, ...)
        // But we need access to the socket.
        // sendMessage(shop, recipient, text)

        // We will try to send to the user's own number if no target is set?
        // Or just fail.

        // TEMPORARY: fail if no target.
        // We will update this after adding settings page.

        if (whatsappSession?.targetJid) {
            await sendMessage(shop, whatsappSession.targetJid, message);
            status = 'SENT';
        } else {
            error = "No target (group/user) configured for this shop.";
            console.log("No target configured, message would be:", message);
        }
    } catch (e: any) {
        console.error("Failed to send WhatsApp message", e);
        error = e.message;
    }

    // 4. Log to DB
    await db.messageLog.create({
        data: {
            shop,
            orderId: String(order.id),
            customerName: `${order.customer?.first_name} ${order.customer?.last_name}`,
            status,
            content: message,
            error
        }
    });

    return new Response();
};
