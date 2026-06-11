import { ArrowUpIcon, BookOpenIcon, ExternalLinkIcon, MessageSquareIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/utils/api';
import { globalEnv } from '@/utils/env';
import { cn } from '@/utils/utils';

import type { ApiUser } from '@nangohq/types';

// ─── Plain types ──────────────────────────────────────────────────────────────

declare global {
    interface Window {
        Plain?: {
            init: (config: PlainConfig) => void;
            update: (config: Partial<PlainConfig>) => void;
            setCustomerDetails: (details: PlainCustomerDetails) => void;
            open: () => void;
            close: () => void;
            onOpen: (cb: () => void) => () => void;
            onClose: (cb: () => void) => () => void;
            isInitialized: () => boolean;
            exportDebugLogs: () => string[];
        };
    }
}

type PlainIcon =
    | 'bell'
    | 'book'
    | 'bug'
    | 'bulb'
    | 'chat'
    | 'integration'
    | 'discord'
    | 'discord_muted'
    | 'email'
    | 'slack'
    | 'slack_muted'
    | 'link'
    | 'pencil'
    | 'send'
    | 'support'
    | 'error';

interface PlainColorPair {
    light: string;
    dark: string;
}

interface PlainThreadDetails {
    labelTypeIds?: string[];
    priority?: 1 | 2 | 3 | 4;
    tierIdentifier?: { tierId: string } | { externalId: string };
    tenantIdentifier?: { tenantId: string } | { externalId: string };
    externalId?: string;
}

interface PlainFormField {
    type: 'dropdown';
    placeholder?: string;
    options: { icon?: PlainIcon; text: string; threadDetails?: PlainThreadDetails }[];
}

interface PlainChatButton {
    icon?: PlainIcon;
    text: string;
    threadDetails?: PlainThreadDetails;
    form?: { fields: PlainFormField[] };
}

interface PlainCustomerDetails {
    email: string;
    emailHash?: string;
    fullName: string;
}

interface PlainConfig {
    appId: string;
    hideLauncher?: boolean;
    theme?: 'light' | 'dark' | 'auto';
    style?: {
        brandColor?: string | PlainColorPair;
        brandBackgroundColor?: string | PlainColorPair;
        launcherBackgroundColor?: string | PlainColorPair;
        launcherIconColor?: string | PlainColorPair;
    };
    logo?: { url: string; alt?: string };
    links?: { icon?: PlainIcon; text: string; url: string }[];
    entryPoint?: { type: 'default' | 'chat'; externalId?: string; singleChatMode?: boolean };
    embedAt?: Element;
    hideBranding?: boolean;
    position?: { right?: string; bottom?: string; zIndex?: string };
    threadDetails?: PlainThreadDetails;
    chatButtons?: PlainChatButton[];
    customerDetails?: PlainCustomerDetails;
    requireAuthentication?: boolean;
}

const PLAIN_CDN = 'https://chat.cdn-plain.com/index.js';

function buildConfig(appId: string, user?: ApiUser, emailHash?: string): PlainConfig {
    return {
        appId,
        theme: 'dark',
        style: {
            brandColor: { light: '#016886', dark: '#00B2E3' },
            brandBackgroundColor: '#02485D',
            launcherBackgroundColor: { light: '#016886', dark: '#00B2E3' },
            launcherIconColor: { light: '#FFFFFF', dark: '#18191B' }
        },
        logo: {
            url: 'https://app.nango.dev/logo-circled.svg',
            alt: 'Nango'
        },
        links: [
            { icon: 'book', text: 'View docs', url: 'https://docs.nango.dev' },
            { icon: 'slack', text: 'Join our Slack', url: 'https://nango.dev/slack' }
        ],
        chatButtons: [
            { icon: 'chat', text: 'Ask a question', threadDetails: {} },
            { icon: 'bulb', text: 'Share feedback', threadDetails: {} }
        ],
        hideBranding: false,
        position: { right: '16px', bottom: '16px', zIndex: '9999' },
        ...(user ? { customerDetails: { email: user.email, emailHash, fullName: user.name } } : { requireAuthentication: true })
    };
}

// ─── Docs search ──────────────────────────────────────────────────────────────

interface DocResult {
    title: string;
    link: string;
    content: string;
}

async function searchNangoDocs(query: string): Promise<DocResult[]> {
    const res = await apiFetch(`/docs-search?q=${encodeURIComponent(query)}`);
    const data = (await res.json()) as { results: DocResult[] };
    return data.results ?? [];
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────

interface AiMessage {
    id: string;
    role: 'user' | 'ai';
    text: string;
    sources?: DocResult[];
    loading?: boolean;
    error?: boolean;
}

const AiPanel: React.FC<{ onClose: () => void; onOpenSupport: () => void }> = ({ onClose, onOpenSupport }) => {
    const [messages, setMessages] = useState<AiMessage[]>([
        { id: 'welcome', role: 'ai', text: 'Ask me anything about Nango — integrations, authentication, syncs, actions, or anything else in the docs.' }
    ]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const autoResize = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || busy) return;

        const userMsgId = `u-${Date.now()}`;
        const aiMsgId = `a-${Date.now()}`;

        setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text }, { id: aiMsgId, role: 'ai', text: '', loading: true }]);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        setBusy(true);

        try {
            const results = await searchNangoDocs(text);
            if (results.length === 0) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === aiMsgId
                            ? {
                                  ...m,
                                  loading: false,
                                  text: "I couldn't find anything in the Nango docs for that. Try rephrasing, or talk to our support team."
                              }
                            : m
                    )
                );
            } else {
                const [top, ...rest] = results;
                const answer = top.content.length > 400 ? top.content.slice(0, 400) + '…' : top.content;
                const sources = [top, ...rest].slice(0, 4);
                setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, loading: false, text: answer, sources } : m)));
            }
        } catch {
            setMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, loading: false, error: true, text: 'Failed to reach the docs. Please try again.' } : m))
            );
        }

        setBusy(false);
        textareaRef.current?.focus();
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    return (
        <div className="bg-bg-elevated border-border-muted flex h-[500px] w-[360px] flex-col overflow-hidden rounded-2xl border shadow-2xl">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-purple-500/20 bg-purple-500/5 px-3 py-2.5">
                <SparklesIcon className="size-4 text-purple-400" />
                <span className="text-text-primary flex-1 text-sm font-semibold">Ask AI</span>
                <span className="text-text-tertiary rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400">
                    Nango docs
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="text-text-tertiary hover:text-text-primary rounded-md p-1 transition-colors"
                >
                    <XIcon className="size-4" />
                </button>
            </div>

            {/* Messages */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
                {messages.map((msg) => (
                    <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                        {msg.role === 'ai' && (
                            <div className="mr-2 flex size-7 shrink-0 items-center justify-center self-start rounded-full bg-purple-500/15 text-purple-400">
                                <SparklesIcon className="size-3.5" />
                            </div>
                        )}
                        <div className={cn('flex max-w-[80%] flex-col gap-2', msg.role === 'user' && 'items-end')}>
                            <div
                                className={cn(
                                    'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                                    msg.role === 'user'
                                        ? 'bg-btn-primary-bg text-btn-primary-fg rounded-br-sm'
                                        : 'bg-bg-surface border-border-muted border text-text-primary rounded-bl-sm',
                                    msg.error && 'border-feedback-error-border text-feedback-error-text'
                                )}
                            >
                                {msg.loading ? (
                                    <span className="flex items-center gap-2">
                                        <Spinner className="size-3.5 text-purple-400" />
                                        <span className="text-text-tertiary text-xs">Searching Nango docs…</span>
                                    </span>
                                ) : (
                                    msg.text
                                )}
                            </div>

                            {msg.sources && msg.sources.length > 0 && (
                                <div className="w-full space-y-1">
                                    <p className="text-text-tertiary px-1 text-[10px] font-medium uppercase tracking-wide">Sources</p>
                                    {msg.sources.map((src) => (
                                        <a
                                            key={src.link}
                                            href={src.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="border-border-muted hover:border-purple-500/40 flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 transition-colors"
                                        >
                                            <BookOpenIcon className="text-text-tertiary size-3.5 shrink-0" />
                                            <span className="text-text-primary min-w-0 flex-1 truncate text-xs">{src.title}</span>
                                            <ExternalLinkIcon className="text-text-tertiary size-3 shrink-0" />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-purple-500/20 bg-purple-500/5 px-3 py-2.5">
                <div className="border-border-muted bg-bg-surface flex items-end gap-1.5 rounded-xl border px-2.5 py-2">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            autoResize();
                        }}
                        onKeyDown={onKeyDown}
                        placeholder="Ask anything about Nango…"
                        disabled={busy}
                        className="text-text-primary placeholder:text-text-tertiary flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none disabled:opacity-50"
                        style={{ maxHeight: '120px' }}
                    />
                    <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={!input.trim() || busy}
                        aria-label="Send"
                        className={cn(
                            'mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white transition-opacity',
                            !input.trim() || busy ? 'opacity-40' : 'hover:opacity-90'
                        )}
                    >
                        {busy ? <Spinner className="size-3.5" /> : <ArrowUpIcon className="size-3.5" />}
                    </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                    <p className="text-text-tertiary text-[10px]">Answers sourced from Nango docs</p>
                    <button
                        type="button"
                        onClick={onOpenSupport}
                        className="text-text-tertiary hover:text-text-primary flex items-center gap-1 text-[10px] transition-colors"
                    >
                        <MessageSquareIcon className="size-3" />
                        Talk to support
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── PlainChat ────────────────────────────────────────────────────────────────

export const PlainChat: React.FC<{ user?: ApiUser }> = ({ user }) => {
    const [aiOpen, setAiOpen] = useState(false);
    const appId = globalEnv.publicPlainAppId;
    // Keep refs so the script onload callback always reads the latest values,
    // even if they change after the script starts loading.
    const userRef = useRef(user);
    userRef.current = user;
    const emailHashRef = useRef<string | undefined>(undefined);
    const scriptStartedRef = useRef(false);

    useEffect(() => {
        if (!appId) return;

        if (user) {
            // Logged-in: fetch HMAC for verified identity, then load or update widget.
            apiFetch('/api/v1/plain/hmac')
                .then((r) => r.json() as Promise<{ data: { hash: string } }>)
                .then(({ data }) => {
                    emailHashRef.current = data.hash;
                    if (window.Plain) {
                        window.Plain.update({
                            customerDetails: { email: user.email, emailHash: data.hash, fullName: user.name },
                            requireAuthentication: false
                        });
                        return;
                    }
                    loadScript(appId);
                })
                .catch(() => loadScript(appId));
        } else {
            // Anonymous: load widget without customer details.
            loadScript(appId);
        }

        function loadScript(id: string) {
            if (scriptStartedRef.current) return;
            scriptStartedRef.current = true;
            const script = document.createElement('script');
            script.src = PLAIN_CDN;
            script.async = true;
            script.onload = () => window.Plain?.init(buildConfig(id, userRef.current, emailHashRef.current));
            document.head.appendChild(script);
        }
    }, [appId, user?.email]);

    const handleOpenSupport = () => {
        setAiOpen(false);
        window.Plain?.open();
    };

    if (!appId) return null;

    return (
        <div className="fixed bottom-[80px] right-4 z-[9998] flex flex-col items-end gap-3">
            {/* AI panel */}
            <div
                className={cn(
                    'transition-all duration-200 origin-bottom-right',
                    aiOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                )}
            >
                <AiPanel onClose={() => setAiOpen(false)} onOpenSupport={handleOpenSupport} />
            </div>

            {/* Ask AI trigger — sits just above the Plain launcher */}
            <button
                onClick={() => setAiOpen((v) => !v)}
                aria-label={aiOpen ? 'Close AI chat' : 'Ask AI'}
                aria-expanded={aiOpen}
                className={cn(
                    'flex items-center gap-1.5 rounded-full bg-purple-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg transition-all',
                    'hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
                    aiOpen && 'bg-purple-500'
                )}
            >
                {aiOpen ? <XIcon className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
                {aiOpen ? 'Close' : 'Ask AI'}
            </button>
        </div>
    );
};
