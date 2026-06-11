import path from 'path';

import cors from 'cors';
import express from 'express';

import { errorManager } from '@nangohq/shared';

import { getDocsSearch } from './controllers/plain/getDocsSearch.js';
import { getEnvJs } from './controllers/v1/getEnvJs.js';
import { getProvidersJSON } from './controllers/v1/getProvidersJSON.js';
import { rateLimiterMiddleware } from './middleware/ratelimit.middleware.js';
import { securityMiddlewares } from './middleware/security.js';
import { getReady } from './ready.js';
import { internalApi } from './routes.internal.js';
import { privateApi } from './routes.private.js';
import { publicAPI } from './routes.public.js';
import { dirname } from './utils/utils.js';

import type { ApiError } from '@nangohq/types';
import type { Request, Response } from 'express';

export const router = express.Router();

router.use(...securityMiddlewares());

// -------
// No auth routes
router.get('/health', (_, res) => {
    res.status(200).send({ result: 'ok' });
});
router.get('/ready', getReady);
router.get('/env.js', getEnvJs);
router.get('/providers.json', rateLimiterMiddleware, getProvidersJSON);
const docsCors = cors({ origin: ['https://app.nango.dev', 'https://app-development.nango.dev', 'https://app-staging.nango.dev', /^http:\/\/localhost:\d+$/] });
router.options('/docs-search', docsCors);
router.get('/docs-search', docsCors, rateLimiterMiddleware, getDocsSearch);

// Import main routers
// Order is important because public API has no prefix
router.use('/api/v1', privateApi);
router.use('/internal', internalApi);
router.use('/', publicAPI);

// -------
// Webapp assets, static files and build.
const webappBuildPath = '../../../webapp/dist';
const staticSite = express.Router();
staticSite.use('/assets', express.static(path.join(dirname(), webappBuildPath), { immutable: true, maxAge: '1y' }));
staticSite.use(express.static(path.join(dirname(), webappBuildPath), { cacheControl: true, maxAge: '1h' }));
staticSite.get('*splat', (_, res) => {
    const fp = path.join(dirname(), webappBuildPath, 'index.html');
    res.sendFile(fp, { headers: { 'Cache-Control': 'no-cache, private' } });
});
router.use(staticSite);

// -------
// Error handling.
router.use((err: any, req: Request, res: Response<ApiError<'invalid_json'>>, _: any) => {
    if (err instanceof SyntaxError && 'body' in err && 'type' in err && err.type === 'entity.parse.failed') {
        res.status(400).send({ error: { code: 'invalid_json', message: err.message } });
        return;
    }

    errorManager.handleGenericError(err, req, res);
});
