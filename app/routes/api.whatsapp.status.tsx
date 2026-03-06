import { type LoaderFunctionArgs } from "react-router";
import { getSessionStatus, getQrCode } from "../services/whatsapp.server";

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

    return Response.json({ status, qr });
};
