import type { ActionFunctionArgs } from "react-router"; // Updated import
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendMessage } from "../services/whatsapp.server";

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

    // 0. Deduplicate — skip if this order already has a log entry (SENT or PENDING)
    const alreadyHandled = await db.messageLog.findFirst({
        where: { shop, orderId: String(order.id) },
    });
    if (alreadyHandled) {
        console.log(`⏭️ Order ${order.name} already handled (${alreadyHandled.status}) — ignoring duplicate webhook`);
        return new Response();
    }

    // 1. Check if order contains at least one selected product
    const selectedProducts = await db.selectedProduct.findMany({ where: { shop } });

    if (selectedProducts.length === 0) {
        console.log(`⏭️ No products configured for ${shop} — skipping WhatsApp send`);
        return new Response();
    }

    const selectedProductIds = new Set(selectedProducts.map((p) => p.productId));

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

    // Extract customer name with multiple fallbacks
    const customerName =
        // 1. From customer object
        (order.customer?.first_name || order.customer?.last_name
            ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
            : null)
        // 2. From shipping address
        || order.shipping_address?.name
        // 3. From billing address
        || order.billing_address?.name
        // 4. From email
        || order.email || order.contact_email
        // 5. Fallback
        || 'Client inconnu';

    console.log(`📋 Order ${order.name} — customer payload:`, JSON.stringify({
        customer: order.customer,
        shipping_name: order.shipping_address?.name,
        billing_name: order.billing_address?.name,
        email: order.email,
    }));

    const message = `📦 Nouvelle Commande ${order.name}
👤 Client : ${customerName}
🛒 Articles :
${itemsList}
💰 Total : ${order.total_price} ${order.currency}
📍 Addresse : ${address}`;

    // 3. Look up target
    const whatsappSession = await db.whatsAppSession.findUnique({ where: { shop } });

    if (!whatsappSession?.targetJid) {
        await db.messageLog.create({
            data: { shop, orderId: String(order.id), customerName, status: 'FAILED', content: message, error: 'No target configured' },
        });
        console.log(`❌ No target configured for ${shop}`);
        return new Response();
    }

    // 4. Create PENDING log IMMEDIATELY (blocks duplicate webhooks)
    const logEntry = await db.messageLog.create({
        data: { shop, orderId: String(order.id), customerName, status: 'PENDING', content: message },
    });

    // 5. Return 200 to Shopify RIGHT AWAY — send WhatsApp in background
    //    This prevents Shopify from retrying the webhook due to timeout.
    sendMessage(shop, whatsappSession.targetJid, message)
        .then(() => {
            db.messageLog.update({ where: { id: logEntry.id }, data: { status: 'SENT' } })
                .catch((e) => console.error('❌ Failed to update log to SENT:', e));
            console.log(`✅ WhatsApp message sent for order ${order.name}`);
        })
        .catch((e) => {
            db.messageLog.update({ where: { id: logEntry.id }, data: { status: 'FAILED', error: e.message } })
                .catch((err) => console.error('❌ Failed to update log to FAILED:', err));
            console.error(`❌ Failed to send WhatsApp for order ${order.name}:`, e);
        });

    return new Response();
};
