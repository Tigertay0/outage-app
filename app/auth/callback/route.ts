import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Where Supabase sends people from a confirmation or password-reset email.
 *
 * The link carries a one-time code that has to be exchanged for a session
 * server-side, so the session cookies are set on a real response rather than in
 * the browser. Everything ends at the map either way: a failure here should
 * leave someone looking at the app with a message, not at an error page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Supabase reports its own failures as query params on this URL, e.g. an
  // expired link. Pass the description through rather than inventing one.
  const errorDescription =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/?auth=error&reason=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth=error&reason=missing-code`);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        `${origin}/?auth=error&reason=${encodeURIComponent(error.message)}`,
      );
    }

    return NextResponse.redirect(`${origin}/?auth=confirmed`);
  } catch (error) {
    console.error("[auth/callback]", error);
    return NextResponse.redirect(`${origin}/?auth=error&reason=unexpected`);
  }
}
