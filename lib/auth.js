
import { createClient } from "./supabase.js";

// Extract a Supabase access token from the
// Authorization: Bearer <token> header.
function getBearerToken(req) {
  const header = req.headers?.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : null;
}

// Verify the token with Supabase Auth.
// Never trust an email or user ID supplied
// directly in the request body.
export async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase authentication is not configured."
    );
  }

  const supabase = createClient();

  const { data, error } =
    await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email?.trim().toLowerCase() || null
  };
}

// Use this in endpoints that require login.
// Returns the verified account or sends HTTP 401.
export async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    res.status(401).json({
      error: "Please sign in to continue."
    });

    return null;
  }

  return user;
}
