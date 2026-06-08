import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isAuthRoute = pathname === "/login";
  const isPublicRoute = pathname === "/";

  if (!isLoggedIn && !isAuthRoute && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
