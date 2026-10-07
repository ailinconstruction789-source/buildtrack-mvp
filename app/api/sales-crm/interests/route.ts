import { handleProjectInterestsGet, handleProjectInterestsPost } from '@/lib/sales/projectInterestsServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleProjectInterestsGet;
export const POST = handleProjectInterestsPost;
