import { type LoaderFunctionArgs } from "react-router";
import { getSessionStatus, getQrCode } from "../services/whatsapp.server";
import db from "../db.server";

// This route is called via fetch() from the embedded frontend,
// so we avoid authenticate.admin which redirects instead of returning JSON.
// The shop is passed as a query param; no sensitive data is returned here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        return Response.json({ error: "Missing shop" }, { status: 400 });
    }

    const status = await getSessionStatus(shop);
    const qr = await getQrCode(shop);

    // Effective order count for this month (with offset applied)
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rawCount = await db.messageLog.count({
        where: { shop, createdAt: { gte: periodStart } },
    });
    const usage = await db.planUsage.upsert({
        where: { shop },
        create: { shop },
        update: {},
    });
    const orderCount = Math.max(0, rawCount - usage.orderCountOffset);

    return Response.json({ status, qr, orderCount });
};
