import { dispatch } from '@/server/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type P = { params: Promise<{ path: string[] }> };
const handle = async (req: Request, { params }: P) => dispatch(req, (await params).path);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
