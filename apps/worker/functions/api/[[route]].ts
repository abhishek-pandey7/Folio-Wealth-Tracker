import { handle } from 'hono/cloudflare-pages';
import { app } from '../../src/app.js';

// Every /api/* request goes to the Hono app. Pages serves all other paths as
// static files from the web build without running any code.
export const onRequest = handle(app);
