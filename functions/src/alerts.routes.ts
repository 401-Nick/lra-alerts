/**
 * @fileoverview Defines API routes for managing user alert subscriptions.
 * Mounted under the "/alerts" path in the main index.ts file.
 */

import { Router, Request, Response } from "express";
import { createAlert, removeAlert, getAlerts } from "./alertEngine";
import { protect } from "./auth.middleware";

// Define valid subscription types for validation
type SubscriptionType = 'zip' | 'parcel' | 'ward' | 'neighborhood';
const VALID_SUBSCRIPTION_TYPES: SubscriptionType[] = ['zip', 'parcel', 'ward', 'neighborhood'];

interface AlertRequestBody {
  type: SubscriptionType;
  value: string | number;
}

const router = Router();

/**
 * GET /
 * Retrieves all alert subscriptions for the authenticated user.
 * Full path: /alerts
 */
router.get("/", protect, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;
    const alerts = await getAlerts(userId);
    return res.json({ ok: true, alerts });
  } catch (e: any) {
    console.error("[GET /alerts] Error:", e);
    return res.status(500).json({ ok: false, error: "Failed to retrieve alerts." });
  }
});

/**
 * POST /
 * Creates a new alert subscription.
 * Full path: /alerts
 */
router.post("/", protect, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { type, value } = req.body as AlertRequestBody;

    if (!type || value == null) {
      return res.status(400).json({ ok: false, error: "Request body must include 'type' and 'value'." });
    }
    if (!VALID_SUBSCRIPTION_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: `Invalid subscription type.` });
    }
    
    await createAlert(userId, type, value);
    return res.status(201).json({ ok: true });
  } catch (e: any) {
    console.error("[POST /alerts] Error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Failed to create alert." });
  }
});

/**
 * DELETE /
 * Removes an alert subscription.
 * Full path: /alerts
 */
router.delete("/", protect, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;
    const { type, value } = req.body as AlertRequestBody;

    if (!type || value == null) {
      return res.status(400).json({ ok: false, error: "Request body must include 'type' and 'value'." });
    }
    if (!VALID_SUBSCRIPTION_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: `Invalid subscription type.` });
    }

    await removeAlert(userId, type, value);
    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /alerts] Error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Failed to remove alert." });
  }
});

export default router;