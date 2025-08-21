// ============================================================================
// functions/src/auth.middleware.ts
// Defines authentication middleware to protect routes.
// ============================================================================

import { getAuth } from "firebase-admin/auth";
import { Request, Response, NextFunction } from "express";

/**
 * Middleware to protect routes by verifying the Firebase ID token.
 * It checks for a 'Bearer' token in the Authorization header.
 * If the token is valid, it attaches the decoded user payload to `req.user`.
 * If the token is missing or invalid, it returns a 401 Unauthorized error.
 */
export const protect = async (req: Request, res: Response, next: NextFunction) => {

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[auth.middleware] Missing or invalid Authorization header:', authHeader);
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing or invalid token format.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    (req as any).user = decodedToken;
    return next(); // Proceed to the next middleware or route handler
  } catch (error: any) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid token.' });
  }
};