import { type LoaderFunctionArgs } from "react-router";
import db from "../db.server";

// Dedicated endpoint for live order count polling from the Autosend page.
// No Shopify auth needed — shop is passed as query param, only aggregate counts returned.
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        return Response.json({ error: "Missing shop" }, { status: 400 });
    }

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

    return Response.json({ orderCount });
};
