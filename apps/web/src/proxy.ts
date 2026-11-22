import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic checks only: a missing session cookie on /app is redirected to
 * sign-in, and the path is passed along for server components. Real
 * authentication happens in every page and API handler.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/app') && !req.cookies.get('lifeos_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const headers = new Headers(req.headers);
  headers.set('x-lifeos-path', pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/app/:path*', '/onboarding/:path*'] };
