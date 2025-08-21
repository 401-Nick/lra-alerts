// ============================================================================
// functions/src/types.d.ts
// Contains custom type declarations for the project.
// ============================================================================

import { DecodedIdToken } from "firebase-admin/auth";

// Extend the Express Request interface to include the authenticated user's data.
// This allows us to access `req.user` in a type-safe way in our protected routes.
declare global {
  namespace Express {
    export interface Request {
      // This attaches the decoded Firebase token to the request object
      // after our 'protect' middleware runs.
      user?: DecodedIdToken;
    }
  }
}
