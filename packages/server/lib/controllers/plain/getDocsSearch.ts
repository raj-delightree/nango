import { asyncWrapper } from '../../utils/asyncWrapper.js';

const NANGO_DOCS_MCP = 'https://nango.dev/docs/mcp';
const QUERY_MAX_LENGTH = 200;
const FETCH_TIMEOUT_MS = 8000;

interface DocResult {
    title: string;
    link: string;
    content: string;
}

async function callDocsMcp(query: string): Promise<DocResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const initRes = await fetch(NANGO_DOCS_MCP, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'initialize',
                params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'nango-support-widget', version: '1.0.0' } },
                id: 1
            }),
            signal: controller.signal
        });

        if (!initRes.ok) {
            throw new Error(`Docs MCP init failed: ${initRes.status}`);
        }

        const sessionId = initRes.headers.get('Mcp-Session-Id');
        const extraHeaders: Record<string, string> = sessionId ? { 'Mcp-Session-Id': sessionId } : {};

        const searchRes = await fetch(NANGO_DOCS_MCP, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extraHeaders },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'search_nango_docs', arguments: { query } },
                id: 2
            }),
            signal: controller.signal
        });

        if (!searchRes.ok) {
            throw new Error(`Docs MCP search failed: ${searchRes.status}`);
        }

        const body = await searchRes.text();
        const dataLine = body.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine && body.trim()) {
            throw new Error(`Docs MCP returned unexpected format: ${body.slice(0, 200)}`);
        }
        const data = dataLine ? (JSON.parse(dataLine.slice(6)) as { result?: { content?: { type: string; text: string }[] } }) : {};
        const rawText = data.result?.content?.find((c) => c.type === 'text')?.text ?? '';

        const results: DocResult[] = [];
        const blocks = rawText.split(/\n(?=Title:)/);
        for (const block of blocks) {
            const title = block.match(/^Title:\s*(.+)/m)?.[1]?.trim();
            const link = block.match(/^Link:\s*(.+)/m)?.[1]?.trim();
            const content = block.match(/^Content:\s*([\s\S]+?)(?=\n(?:Title|Link|Page|Content):|$)/m)?.[1]?.trim();
            if (title && link && content) {
                results.push({ title, link, content });
            }
        }
        return results;
    } finally {
        clearTimeout(timeout);
    }
}

export const getDocsSearch = asyncWrapper(async (req, res) => {
    const query = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
    if (!query || query.length > QUERY_MAX_LENGTH) {
        res.status(400).send({ error: { code: 'invalid_query', message: `q must be 1–${QUERY_MAX_LENGTH} characters` } });
        return;
    }

    const results = await callDocsMcp(query);
    res.status(200).json({ results });
});
