/**
 * @fileoverview Main entry point for the Firebase Functions Express API.
 * This file initializes services, configures global middleware, and mounts all API route modules.
 */

import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
initializeApp();

import { getFirestore } from "firebase-admin/firestore";
export const db = getFirestore();

import express from "express";
import cors from "cors";

// Import application modules
import { initAlertEngine } from "./alertEngine";
import authRouter from "./auth.routes";
import alertsRouter from "./alerts.routes";
import debugRouter from "./debug.routes";
import propertiesRouter from "./properties.routes"; // <-- Import the new router

// ============================================================================
// Initialization
// ============================================================================

// Initialize the alert engine with the Firestore instance
initAlertEngine(db);

// ============================================================================
// Express App Configuration
// ============================================================================
const app = express();

// --- Global Middleware ---

// Configure a robust CORS policy
const allowedOrigins = [
  'http://localhost:5173', // for local development
  // 'https://your-production-url.com'
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

// Add a simple logger for all incoming requests (MUST be before routes)
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.originalUrl}`);
  next();
});

// Parse JSON request bodies
app.use(express.json());

// --- API Route Mounting ---
app.use('/auth', authRouter);       // e.g., /auth/google
app.use('/alerts', alertsRouter);   // e.g., /alerts
app.use('/debug', debugRouter);     // e.g., /debug/ingest
app.use('/properties', propertiesRouter); // e.g., /properties or /properties/selections

console.log('✅ API Routes Mounted: /auth, /alerts, /debug, /properties');

// ============================================================================
// Export the Cloud Function
// ============================================================================
export const api = onRequest({ timeoutSeconds: 540, region: 'us-central1' }, app);