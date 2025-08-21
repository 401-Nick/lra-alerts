// ============================================================================
// functions/src/auth.routes.ts
// Handles all authentication-related API routes.
// ============================================================================

import { Router, Request, Response } from "express";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { protect } from "./auth.middleware";

/**
 * Defines the standard JSON response structure for API endpoints.
 */
interface ApiResponse {
  ok: boolean;
  user?: {
    id: string;
    email: string | undefined;
    name: string | undefined;
    alerts: string[];
  };
  error?: string;
}

/**
 * Type for the request body when registering a new user.
 */
interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

/**
 * Type for the request body when signing in with Google.
 */
interface GoogleLoginRequest {
  idToken: string;
}

// --- Router Setup ---

const router = Router();
const db = getFirestore();

// --- Route Implementations ---

/**
 * @route   POST /api/auth/register
 * @desc    Creates a new user with email and password.
 * @access  Public
 * @body    { email, password, name }
 * @returns {ApiResponse} Success or error message.
 */
router.post('/register', async (req: Request<{}, {}, RegisterRequest>, res: Response<ApiResponse>) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ ok: false, error: 'Email, password, and name are required.' });
    }

    // Create user in Firebase Authentication
    const userRecord = await getAuth().createUser({ email, password, displayName: name });
    
    // Create a corresponding user profile in Firestore
    await db.collection('users').doc(userRecord.uid).set({
      name: userRecord.displayName,
      email: userRecord.email,
      createdAt: new Date().toISOString(),
      alerts: [], // Initialize with an empty alerts array
    });

    console.log(`User registered successfully: ${userRecord.uid}`);
    return res.status(201).json({
      ok: true,
      user: {
        id: userRecord.uid,
        email: userRecord.email,
        name: userRecord.displayName,
        alerts: [],
      },
    });
  } catch (error: any) {
    console.error('[API-ERROR /auth/register]', error);
    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({ ok: false, error: 'A user with this email already exists.' });
    }
    return res.status(500).json({ ok: false, error: 'An unexpected error occurred during registration.' });
  }
});

/**
 * @route   POST /api/auth/google
 * @desc    Handles user sign-in or sign-up via a Google ID token.
 * @access  Public
 * @body    { idToken }
 * @returns {ApiResponse} Success or error message.
 */
router.post('/google', async (req: Request<{}, {}, GoogleLoginRequest>, res: Response<ApiResponse>) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ ok: false, error: 'Google ID token is required.' });
    }

    // Verify the ID token and decode it
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const { uid, name, email } = decodedToken;

    if (!uid || !email) {
      return res.status(400).json({ ok: false, error: 'Invalid Google ID token: UID or email missing.' });
    }
    
    let userRecord: UserRecord;
    try {
      userRecord = await getAuth().getUser(uid);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // If user does not exist, create a new one
        console.log(`Creating new user from Google token: ${uid}`);
        userRecord = await getAuth().createUser({ uid, email, displayName: name });
      } else {
        // Re-throw other auth errors
        throw error;
      }
    }

    // Ensure a user profile exists in Firestore
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log(`Creating Firestore profile for Google user: ${uid}`);
      await userRef.set({
        name: userRecord.displayName,
        email: userRecord.email,
        createdAt: new Date().toISOString(),
        alerts: [],
      });
    }

    const userData = (await userRef.get()).data();

    return res.status(200).json({
      ok: true,
      user: {
        id: userRecord.uid,
        email: userRecord.email,
        name: userRecord.displayName,
        alerts: userData?.alerts || [],
      },
    });
  } catch (error: any) {
    console.error('[API-ERROR /auth/google]', error);
    if (error.code?.startsWith('auth/')) {
       return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid or expired Google ID token.' });
    }
    return res.status(500).json({ ok: false, error: 'An unexpected error occurred during Google sign-in.' });
  }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Fetches the profile of the currently authenticated user.
 * @access  Private (Requires authentication)
 * @returns {ApiResponse} User profile data or error message.
 */
router.get('/profile', protect, async (req: Request, res: Response<ApiResponse>) => {
  try {
    // The user object is attached to the request by the 'protect' middleware
    const userId = req.user!.uid; 
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.warn(`Firestore profile not found for authenticated user: ${userId}`);
      return res.status(404).json({ ok: false, error: 'User profile not found.' });
    }
    
    const profile = userDoc.data()!;
    
    return res.json({
      ok: true,
      user: {
        id: userId,
        email: profile.email,
        name: profile.name,
        alerts: profile.alerts || [], // Default to empty array if alerts is missing
      },
    });
  } catch (error: any) {
    console.error('[API-ERROR /auth/profile]', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch user profile.' });
  }
});

export default router;