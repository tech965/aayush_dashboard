import { handleOrderWebhook } from "../../shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOrderWebhook(request);
}
