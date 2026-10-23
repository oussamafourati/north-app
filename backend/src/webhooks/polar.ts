import type { Request, Response } from "express";
import { getEnv } from "../lib/env.js";
import { checkoutSessions, orderItems, orders } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { webhooks } from "@polar-sh/sdk/2026-10";

function headerString(headers: Request["headers"], name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function checkoutSessionIdFromMetadata(order: {
  metadata?: Record<string, unknown> | null;
}): string | undefined {
  const sessionId = order.metadata?.checkout_session_id;

  return typeof sessionId === "string" ? sessionId : undefined;
}

async function alreadyPaid(
  polarOrderId?: string,
  checkoutId?: string,
): Promise<boolean> {
  if (polarOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarOrderId, polarOrderId))
      .limit(1);

    if (row?.status === "paid") return true;
  }

  if (checkoutId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.polarCheckoutId, checkoutId))
      .limit(1);

    if (row?.status === "paid") return true;
  }

  return false;
}

async function fulfillCheckoutSession(
  sessionId: string,
  polarOrderId: string | undefined,
  checkoutId: string | undefined,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId))
      .for("update");

    if (!session) return false;

    const [order] = await tx
      .insert(orders)
      .values({
        userId: session.userId,
        status: "paid",
        totalCents: session.totalCents,
        polarCheckoutId: checkoutId ?? session.polarCheckoutId ?? null,
        ...(polarOrderId ? { polarOrderId } : {}),
      })
      .returning();

    if (!order) {
      throw new Error("Failed to create local order");
    }

    if (session.lines.length > 0) {
      await tx.insert(orderItems).values(
        session.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      );
    }

    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));

    return true;
  });
}

export async function polarWebhookHandler(req: Request, res: Response) {
  console.log("[Polar webhook] Request received");
  console.log("[Polar webhook] Raw body is Buffer:", Buffer.isBuffer(req.body));
  console.log("[Polar webhook] Webhook ID:", req.headers["webhook-id"]);

  const env = getEnv();

  try {
    if (!env.POLAR_WEBHOOK_SECRET) {
      res.status(503).send("Polar webhooks not configured");
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      console.error("[Polar webhook] Raw request body unavailable");
      res.status(400).json({ error: "Expected raw webhook body" });
      return;
    }

    const raw: Buffer = req.body;

    const id = headerString(req.headers, "webhook-id");
    const ts = headerString(req.headers, "webhook-timestamp");
    const sig = headerString(req.headers, "webhook-signature");

    if (!id || !ts || !sig) {
      res.status(400).json({ error: "Missing webhook headers" });
      return;
    }

    const event = await webhooks.validateEvent(
      raw,
      {
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": sig,
      },
      env.POLAR_WEBHOOK_SECRET,
    );

    console.log("[Polar webhook] Signature verified");
    console.log("[Polar webhook] Event type:", event.type);

    if (event.type !== "order.paid") {
      res.json({ ok: true, ignored: true });
      return;
    }

    const data = event.data;

    console.log("[Polar webhook] Paid order data:", {
      orderId: data.id,
      checkoutId: data.checkout_id,
      metadata: data.metadata,
    });

    const polarOrderId = data.id;
    const checkoutId = data.checkout_id ?? undefined;

    if (await alreadyPaid(polarOrderId, checkoutId)) {
      console.log("[Polar webhook] Order already fulfilled");
      res.json({ ok: true, duplicate: true });
      return;
    }

    const sessionId = checkoutSessionIdFromMetadata(data);

    console.log("[Polar webhook] Local checkout session ID:", sessionId);

    if (!sessionId) {
      console.error(
        "[Polar webhook] Missing checkout_session_id in order metadata",
        { polarOrderId, checkoutId },
      );

      res.status(500).json({
        error: "Missing local checkout session ID in order metadata",
      });
      return;
    }

    const fulfilled = await fulfillCheckoutSession(
      sessionId,
      polarOrderId,
      checkoutId,
    );

    console.log("[Polar webhook] Fulfillment result:", fulfilled);

    if (fulfilled) {
      res.json({ ok: true });
      return;
    }

    // Another delivery may have fulfilled the order while this request waited.
    if (await alreadyPaid(polarOrderId, checkoutId)) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    console.error("[Polar webhook] Local checkout session not found", {
      sessionId,
      polarOrderId,
      checkoutId,
    });

    res.status(500).json({
      error: "Checkout session not found or fulfillment failed",
    });
  } catch (error) {
    console.error("[Polar webhook] Error:", error);

    if (error instanceof Error) {
      console.error("[Polar webhook] Error message:", error.message);
    }

    // Return an error so Polar can retry transient failures.
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
