/**
 * @fileoverview Manages the alert engine for LRA property subscriptions.
 * Handles triggering notifications and managing user subscriptions.
 * NOTE: This module must be initialized by calling `initAlertEngine` from the main application entry point.
 */

import { LraRow } from "./arcgis";
import { Firestore, FieldValue } from 'firebase-admin/firestore';
// import axios from "axios"; // Uncomment when implementing Slack notifications

// ============================================================================
// Module-level Variables
// ============================================================================

let db: Firestore; // Firestore instance, injected via initAlertEngine
const DEBUG = process.env.DEBUG === 'true';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

type SubscriptionType = 'zip' | 'parcel' | 'ward' | 'neighborhood';

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the alert engine with a Firestore instance.
 * This dependency injection pattern prevents race conditions and ensures a single Firestore instance is used.
 * @param firestoreDb The initialized Firestore database instance from `firebase-admin`.
 */
export function initAlertEngine(firestoreDb: Firestore): void {
    if (db) {
        console.warn("Alert Engine has already been initialized.");
        return;
    }
    db = firestoreDb;
    console.log("Alert Engine Initialized successfully.");
}

// ============================================================================
// Logging Utility
// ============================================================================

/**
 * Logs messages to the console if debugging is enabled.
 * @param message The message to log.
 */
function debugLog(message: string) {
  if (DEBUG) {
    console.log(`[debug! alertEngine] ${message}`);
  }
}

// ============================================================================
// Alert Triggers (Called from Ingest Process)
// ============================================================================

/**
 * Processes alerts for a newly added property.
 * @param property The property that was added.
 */
export async function addedAlert(property: LraRow): Promise<void> {
  const message = `✅ New Property Added: ${property.address}`;
  debugLog(`Processing 'added' event for ${property.address}`);
  await sendAlertsForProperty(property, ['zip', 'parcel', 'ward', 'neighborhood'], message);
}

/**
 * Processes alerts for a modified property.
 * @param property The property that was changed.
 */
export async function changedAlert(property: LraRow): Promise<void> {
  const message = `🔄 Property Changed: ${property.address}`;
  debugLog(`Processing 'changed' event for ${property.address}`);
  await sendAlertsForProperty(property, ['parcel', 'ward', 'neighborhood'], message);
}

/**
 * Processes alerts for a removed property.
 * @param property The property that was removed.
 */
export async function removedAlert(property: LraRow): Promise<void> {
  const message = `❌ Property Removed: ${property.address}`;
  debugLog(`Processing 'removed' event for ${property.address}`);
  await sendAlertsForProperty(property, ['zip', 'parcel', 'ward', 'neighborhood'], message);
}

// ============================================================================
// Core Notification Logic
// ============================================================================

/**
 * Gathers all subscribers for a given property and triggers notifications.
 * @param propertyData The property data that triggered the alert.
 * @param alertTypes The types of subscriptions to check for (e.g., 'zip', 'parcel').
 * @param slackMessage The message to send to Slack.
 */
async function sendAlertsForProperty(propertyData: LraRow, alertTypes: SubscriptionType[], slackMessage: string): Promise<void> {
    const notificationPromises: Promise<void>[] = [];
    
    // Map subscription types to the corresponding values from the property data.
    const valueMap: Partial<Record<SubscriptionType, string | number | null>> = {
        zip: propertyData.zip,
        parcel: propertyData.parcelId,
        ward: propertyData.ward,
        neighborhood: propertyData.neighborhood,
    };
    
    // Create notification promises for each relevant subscription type.
    for (const type of alertTypes) {
        const value = valueMap[type];
        if (value != null) { // This check correctly handles both null and undefined
            notificationPromises.push(notifySubscribers(type, value, slackMessage));
        }
    }
    
    // Send a global notification to Slack if configured.
    if (SLACK_WEBHOOK_URL) {
        // Example implementation for sending a Slack message.
        // notificationPromises.push(
        //   axios.post(SLACK_WEBHOOK_URL, { text: slackMessage })
        //        .catch(err => console.error("Slack notification failed:", err.message))
        // );
        console.log(`SLACK MOCK: ${slackMessage}`);
    }

    await Promise.allSettled(notificationPromises);
    debugLog(`All alerts for ${propertyData.address} have been processed.`);
}

/**
 * Queries for subscribers based on a specific criterion and sends them a notification.
 * @param type The subscription type (e.g., 'zip').
 * @param value The value to match (e.g., '63104').
 * @param title The title of the notification.
 */
async function notifySubscribers(type: SubscriptionType, value: string | number, title: string): Promise<void> {
  debugLog(`Querying subscribers for type: ${type}, value: ${value}`);

  const subscribersSnapshot = await db.collection('subscriptions')
    .where('type', '==', type)
    .where('value', '==', value)
    .get();

  if (subscribersSnapshot.empty) {
    debugLog(`No subscribers found for ${type}: ${value}`);
    return;
  }
  
  debugLog(`Found ${subscribersSnapshot.size} subscribers for ${type}: ${value}.`);
  
  const notificationTasks = subscribersSnapshot.docs.map(doc => {
    const subscriber = doc.data();
    
    // TODO: Replace this with your actual notification logic (FCM, SendGrid, etc.).
    const notificationPromise = Promise.resolve().then(() => 
        console.log(`- NOTIFYING user ${subscriber.userId} about ${title}`)
    );
    return notificationPromise;
  });
  
  await Promise.allSettled(notificationTasks);
}

// ============================================================================
// Subscription Management API
// ============================================================================

/**
 * Creates a subscription for a user.
 * @param userId The ID of the user.
 * @param type The type of subscription.
 * @param value The value to subscribe to.
 */
export async function createAlert(userId: string, type: SubscriptionType, value: string | number): Promise<void> {
  if (!userId) throw new Error("User ID is required to create an alert.");
  debugLog(`Creating alert for user ${userId}: type=${type}, value=${value}`);

  const subscriptionId = `${userId}_${type}_${value}`;
  await db.collection('subscriptions').doc(subscriptionId).set({
    userId,
    type,
    value,
    createdAt: FieldValue.serverTimestamp(),
  });
  
  debugLog("Alert created successfully.");
}

/**
 * Removes a user's subscription.
 * @param userId The ID of the user.
 * @param type The type of subscription.
 * @param value The value of the subscription.
 */
export async function removeAlert(userId: string, type: SubscriptionType, value: string | number): Promise<void> {
  if (!userId) throw new Error("User ID is required to remove an alert.");
  debugLog(`Removing alert for user ${userId}: type=${type}, value=${value}`);

  const subscriptionId = `${userId}_${type}_${value}`;
  await db.collection('subscriptions').doc(subscriptionId).delete();
  
  debugLog("Alert removed successfully.");
}

/**
 * Retrieves all subscriptions for a given user, grouped by type.
 * @param userId The ID of the user.
 * @returns An object containing the user's subscriptions.
 */
export async function getAlerts(userId: string): Promise<Record<SubscriptionType, (string | number)[]>> {
  if (!userId) throw new Error("User ID is required to get alerts.");
  debugLog(`Getting alerts for user ${userId}`);

  const subscriptionsSnapshot = await db.collection('subscriptions').where('userId', '==', userId).get();
  
  // Initialize the result object with empty arrays for all subscription types.
  const initialAlerts: Record<SubscriptionType, (string | number)[]> = {
    zip: [], parcel: [], ward: [], neighborhood: [],
  };

  if (subscriptionsSnapshot.empty) {
    debugLog("No alerts found for this user.");
    return initialAlerts;
  }
  
  // Use reduce to group subscriptions by type.
  const alerts = subscriptionsSnapshot.docs.reduce((acc, doc) => {
    const { type, value } = doc.data() as { type: SubscriptionType; value: string | number };
    if (acc[type]) {
      acc[type].push(value);
    }
    return acc;
  }, initialAlerts);

  debugLog(`Found alerts for user ${userId}: ${JSON.stringify(alerts)}`);
  return alerts;
}