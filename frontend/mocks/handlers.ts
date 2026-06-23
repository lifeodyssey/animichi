/**
 * Dev-mode MSW handlers.
 *
 * Empty since the homepage-only cleanup: the landing page calls no runtime
 * APIs (auth goes straight to Supabase). Add handlers here when API-backed
 * pages return.
 */
import type { RequestHandler } from "msw";

export const handlers: RequestHandler[] = [];
