import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();

  const isAuthed = !!data.user;
  const path = req.nextUrl.pathname;

  const protectedPaths = ["/collection", "/decks"];
  const isProtected = protectedPaths.some((p) => path.startsWith(p));

  if (isProtected && !isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (path === "/login" && isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = "/collection";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/collection/:path*", "/decks/:path*", "/login"],
};
