// One catch-all route: every path is handled by the framework-neutral router in src/handlers.ts.
import { dispatch } from '../../src/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = dispatch;
export const POST = dispatch;
