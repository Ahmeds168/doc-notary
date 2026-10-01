import { HttpError } from "./errors.js";

/**
 * Verifies Supabase access tokens server-side. The user id comes ONLY from the verified
 * token — never from a client-supplied header, body field, query param or wallet address.
 */
export function createAuthVerifier(supabase) {
  return {
    async verify(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
  };
}

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

export function requireAuth(authVerifier, log) {
  return async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) return next(new HttpError(401, "AUTH_REQUIRED", "Sign in to continue."));
    try {
      const user = await authVerifier.verify(token);
      if (!user) return next(new HttpError(401, "AUTH_INVALID", "Your session has expired. Please sign in again."));
      req.user = user;
      next();
    } catch (err) {
      log?.error("[auth] token verification failed", err);
      next(new HttpError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable. Please try again."));
    }
  };
}
