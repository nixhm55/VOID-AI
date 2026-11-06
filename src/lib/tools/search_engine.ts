import { isModelIdentityQuery } from './identity_guard.js';

export interface OmniSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface OmniSearchResponse {
  query: string;
  provider: string;
  answer?: string | null;
  results: OmniSearchResultItem[];
}

/**
 * Active search providers configured in OmniRoute (Tavily, Serper, SearXNG).
 */
export const OMNIROUTE_SEARCH_PROVIDERS: Array<string | undefined> = [
  undefined,
  'tavily',
  'serper',
  'searxng',
  'tavily-search',
  'serper-search',
  'searxng-search',
];

/**
 * OpenAI-compatible function tool definition for OmniRoute Web Search.
 */
export const WEB_SEARCH_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the live web (via OmniRoute Tavily, Serper, and SearXNG) for current events, real-time prices, news, weather, facts, people, or up-to-date information.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute on the live web.',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Automatically detects when a user query asks for real-time data, live web facts,
 * current events, prices, weather, news, or up-to-date information across English,
 * Malayalam, and Hindi.
 */
export function shouldTriggerWebSearch(userText: string): boolean {
  const raw = userText.trim();
  if (!raw) return false;

  if (isModelIdentityQuery(raw)) return false;

  // Skip pure casual greetings or short acknowledgments
  if (
    /^(?:hi|hello|hey|yo|hola|namaskaram|sukhamano|sugamano|good\s+(?:morning|afternoon|evening|night)|thanks|thank\s+you|ok|okay|हाय|हेलो|नमस्ते|कैसे\s+हो|ഹായ്|ഹലോ|നമസ്കാരം|സുഖമാണോ)\b[!?.]*$/i.test(
      raw,
    )
  ) {
    return false;
  }

  // Explicit @Web search tag
  if (/@web\s*search\b/i.test(raw)) {
    return true;
  }

  const lower = raw.toLowerCase();

  const realtimePatterns = [
    /\b(search|google|browse|look\s+up|find\s+out|check\s+online|fetch\s+live|web)\b/,
    /\b(price|prices|rate|rates|market|stock|stocks|share|shares|index|worth|market\s+cap|valuation|quote|trading|cost)\b/,
    /\b(oil|crude|wti|brent|gold|silver|bitcoin|btc|ethereum|eth|solana|sol|crypto|sensex|nifty|nasdaq|dow|s&p|usd|inr|eur|gbp| petrol|diesel)\b/,
    /\b(today|tonight|right\s+now|currently|current|latest|live|breaking|recent|recently|this\s+week|this\s+month|this\s+year|yesterday|now|2024|2025|2026|2027)\b/,
    /\b(weather|forecast|temperature|rain|news|headlines|score|scores|match|standings|winner|who\s+won|election|results|box\s+office|release\s+date|update|updates|version)\b/,
    /\bwho\s+is\s+(the\s+)?(current\s+)?(ceo|president|prime\s+minister|chief\s+minister|leader|owner|head|champion|richest|founder|governor|mayor)\b/,
    /\bwhat\s+is\s+happening\b/,
    /https?:\/\/[^\s]+/i,
    // Malayalam real-time cues (ഇന്ന്, ഇന്നത്തെ, വില, വാർത്ത, കാലാവസ്ഥ, ഇപ്പോൾ, പുതിയ, ആരാണ്)
    /(?:ഇന്ന്|ഇന്നത്തെ|ഇപ്പോൾ|വില|വാർത്ത|വാർത്തകൾ|കാലാവസ്ഥ|മഴ|സ്വർണ്ണവില|സ്വർണ്ണം|പെട്രോൾ|ക്രിക്കറ്റ്|മത്സരം|തിരഞ്ഞെടുപ്പ്|ഫലം|പുതിയ|റിലീസ്|ആരാണ്\s+മുഖ്യമന്ത്രി|ആരാണ്\s+പ്രധാനമന്ത്രി|സെർച്ച്)/,
    // Hindi real-time cues (आज, ताज़ा, खबर, समाचार, कीमत, भाव, मौसम, कौन है)
    /(?:आज|ताज़ा|ताजा|खबर|समाचार|कीमत|भाव|रेट|मौसम|स्कोर|मैच|चुनाव|प्रधानमंत्री|मुख्यमंत्री|सर्च)/,
  ];

  return realtimePatterns.some((re) => re.test(lower));
}

export function extractInlineWebSearchQuery(text: string): string | null {
  const xmlMatch = /<web_search>\s*([\s\S]*?)\s*<\/web_search>/i.exec(text);
  if (xmlMatch && xmlMatch[1]?.trim()) {
    return xmlMatch[1].trim();
  }
  const bracketMatch = /\[WEB_SEARCH:\s*([^\]]+)\]/i.exec(text);
  if (bracketMatch && bracketMatch[1]?.trim()) {
    return bracketMatch[1].trim();
  }
  return null;
}

export function isRealtimeRefusalResponse(text: string): boolean {
  const lower = text.toLowerCase();
  const refusalPatterns = [
    /if\s+this\s+development\s+environment\s+has\s+external\s+internet\s+access/,
    /don't\s+have\s+access\s+to\s+real[-\s]?time/,
    /do\s+not\s+have\s+access\s+to\s+real[-\s]?time/,
    /don't\s+have\s+(?:access\s+to\s+)?(?:real[-\s]?time|live|current)\s+(?:information|data|internet|web|financial)/,
    /do\s+not\s+have\s+(?:access\s+to\s+)?(?:real[-\s]?time|live|current)\s+(?:information|data|internet|web|financial)/,
    /cannot\s+(?:browse\s+the\s+internet|access\s+live|fetch\s+real[-\s]?time|provide\s+real[-\s]?time|provide\s+today's\s+live)/,
    /can't\s+(?:browse\s+the\s+internet|access\s+live|fetch\s+real[-\s]?time|provide\s+real[-\s]?time|provide\s+today's\s+live)/,
    /knowledge\s+cutoff/,
    /pip\s+install\s+yfinance/,
    /don't\s+have\s+direct\s+internet\s+access/,
    /unable\s+to\s+access\s+live\s+market\s+data/,
    /തത്സമയ\s*വിവരങ്ങൾ\s*ലഭ്യമല്ല/,
    /ഇന്റർനെറ്റ്\s*സൗകര്യം\s*ഇല്ല/,
  ];
  return refusalPatterns.some((re) => re.test(lower));
}

export function buildSearchQuery(
  userText: string,
  conversation: Array<{ role?: string; content?: string }>,
): string {
  let cleaned = userText
    .replace(/@web\s*search\b/gi, '')
    .replace(/^\/[a-z]+\s+/i, '')
    .replace(
      /^(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:search\s+(?:for\s+me\s+|for\s+|the\s+web\s+for\s+)?|look\s+up\s+|find\s+(?:for\s+me\s+)?)/i,
      '',
    )
    .trim();

  if (!cleaned) {
    cleaned = userText.replace(/@web\s*search\b/gi, '').trim();
  }

  if (cleaned.split(/\s+/).length <= 4 && conversation.length >= 2) {
    const prevUserMessages = conversation
      .slice(0, -1)
      .filter((m) => m.role === 'user' && m.content)
      .map((m) =>
        String(m.content)
          .replace(/@web\s*search\b/gi, '')
          .trim(),
      );
    const prevUser = prevUserMessages[prevUserMessages.length - 1];
    if (prevUser && prevUser.length < 160) {
      cleaned = `${prevUser} ${cleaned}`.trim();
    }
  }

  return cleaned.slice(0, 300);
}

/**
 * Queries OmniRoute's `/v1/search` endpoint (supporting Tavily, Serper, and SearXNG).
 */
async function postSingleOmniSearch(options: {
  searchEndpoint: string;
  apiKey: string;
  query: string;
  maxResults: number;
  provider?: string;
}): Promise<OmniSearchResponse> {
  const { searchEndpoint, apiKey, query, maxResults, provider } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const payload: Record<string, unknown> = {
      query,
      q: query,
      max_results: maxResults,
      num: maxResults,
    };
    if (provider) {
      payload.provider = provider;
      payload.engine = provider;
    }

    const res = await fetch(searchEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const rawResults = Array.isArray(data)
      ? data
      : Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.organic)
          ? data.organic
          : Array.isArray(data.data)
            ? data.data
            : [];

    const normalizedResults: OmniSearchResultItem[] = rawResults
      .map((item: unknown): OmniSearchResultItem | null => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as Record<string, unknown>;
        const title = String(rec.title ?? rec.name ?? '').trim();
        const url = String(rec.url ?? rec.link ?? '').trim();
        const snippet = String(
          rec.snippet ?? rec.content ?? rec.description ?? rec.summary ?? '',
        ).trim();
        const publishedDate =
          rec.published_date ?? rec.publishedDate ?? rec.date;
        if (!title && !snippet && !url) return null;
        return {
          title: title || url || 'Web Result',
          url,
          snippet,
          publishedDate: publishedDate ? String(publishedDate) : undefined,
        };
      })
      .filter((r): r is OmniSearchResultItem => r !== null);

    const answer =
      typeof data.answer === 'string' && data.answer.trim()
        ? data.answer.trim()
        : typeof data.answerBox === 'object' && data.answerBox !== null
          ? String(
              (data.answerBox as Record<string, unknown>).answer ??
                (data.answerBox as Record<string, unknown>).snippet ??
                '',
            ).trim() || null
          : null;

    if (normalizedResults.length === 0 && !answer) {
      throw new Error('Empty search results');
    }

    return {
      query,
      provider: String(data.provider ?? provider ?? 'omniroute-search'),
      answer,
      results: normalizedResults,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches live real-time market quotes when the query involves commodities, crypto, forex, or indices.
 */
async function fetchLiveMarketQuotes(
  query: string,
): Promise<OmniSearchResultItem[]> {
  const lower = query.toLowerCase();
  const tickers: Array<{ symbol: string; label: string; url: string }> = [];

  if (/\b(oil|crude|wti|brent|petroleum|energy)\b/.test(lower)) {
    tickers.push(
      {
        symbol: 'CL=F',
        label: 'US WTI Crude Oil Futures (CL=F)',
        url: 'https://finance.yahoo.com/quote/CL=F',
      },
      {
        symbol: 'BZ=F',
        label: 'Brent Crude Oil Futures (BZ=F)',
        url: 'https://finance.yahoo.com/quote/BZ=F',
      },
    );
  }
  if (/\b(gold|xau)\b|സ്വർണ്ണ|सोना/.test(lower)) {
    tickers.push({
      symbol: 'GC=F',
      label: 'Gold Futures (GC=F)',
      url: 'https://finance.yahoo.com/quote/GC=F',
    });
  }
  if (/\b(silver|xag)\b|വെള്ളി|चांदी/.test(lower)) {
    tickers.push({
      symbol: 'SI=F',
      label: 'Silver Futures (SI=F)',
      url: 'https://finance.yahoo.com/quote/SI=F',
    });
  }
  if (/\b(bitcoin|btc)\b/.test(lower)) {
    tickers.push({
      symbol: 'BTC-USD',
      label: 'Bitcoin USD (BTC-USD)',
      url: 'https://finance.yahoo.com/quote/BTC-USD',
    });
  }
  if (/\b(ethereum|eth)\b/.test(lower)) {
    tickers.push({
      symbol: 'ETH-USD',
      label: 'Ethereum USD (ETH-USD)',
      url: 'https://finance.yahoo.com/quote/ETH-USD',
    });
  }
  if (/\b(solana|sol)\b/.test(lower)) {
    tickers.push({
      symbol: 'SOL-USD',
      label: 'Solana USD (SOL-USD)',
      url: 'https://finance.yahoo.com/quote/SOL-USD',
    });
  }
  if (/\b(s&p|sp500|s&p\s*500)\b/.test(lower)) {
    tickers.push({
      symbol: '^GSPC',
      label: 'S&P 500 Index (^GSPC)',
      url: 'https://finance.yahoo.com/quote/%5EGSPC',
    });
  }
  if (/\b(nasdaq)\b/.test(lower)) {
    tickers.push({
      symbol: '^IXIC',
      label: 'NASDAQ Composite (^IXIC)',
      url: 'https://finance.yahoo.com/quote/%5EIXIC',
    });
  }
  if (/\b(dow|dow\s+jones)\b/.test(lower)) {
    tickers.push({
      symbol: '^DJI',
      label: 'Dow Jones Industrial Average (^DJI)',
      url: 'https://finance.yahoo.com/quote/%5EDJI',
    });
  }
  if (/\b(nifty)\b/.test(lower)) {
    tickers.push({
      symbol: '^NSEI',
      label: 'NIFTY 50 (^NSEI)',
      url: 'https://finance.yahoo.com/quote/%5ENSEI',
    });
  }
  if (/\b(sensex)\b/.test(lower)) {
    tickers.push({
      symbol: '^BSESN',
      label: 'BSE SENSEX (^BSESN)',
      url: 'https://finance.yahoo.com/quote/%5EBSESN',
    });
  }
  if (/\b(usd\s*to\s*inr|inr|rupee|dollar\s*rate)\b/.test(lower)) {
    tickers.push({
      symbol: 'INR=X',
      label: 'USD/INR Exchange Rate (INR=X)',
      url: 'https://finance.yahoo.com/quote/INR=X',
    });
  }

  if (tickers.length === 0) return [];

  const results = await Promise.all(
    tickers.map(async (t): Promise<OmniSearchResultItem | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.symbol)}?interval=1d&range=5d`;
        const res = await fetch(endpoint, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, unknown>;
        const chart = data.chart as Record<string, unknown> | undefined;
        const resultArr = Array.isArray(chart?.result) ? chart.result : [];
        const first =
          resultArr.length > 0 &&
          resultArr[0] &&
          typeof resultArr[0] === 'object'
            ? (resultArr[0] as Record<string, unknown>)
            : null;
        const meta =
          first?.meta && typeof first.meta === 'object'
            ? (first.meta as Record<string, unknown>)
            : null;
        if (!meta) return null;

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose;
        const high = meta.regularMarketDayHigh;
        const low = meta.regularMarketDayLow;
        const currency = String(meta.currency ?? 'USD');
        const marketTime =
          typeof meta.regularMarketTime === 'number'
            ? new Date(meta.regularMarketTime * 1000).toUTCString()
            : new Date().toUTCString();

        if (typeof price !== 'number') return null;

        let changeStr = '';
        if (typeof prevClose === 'number' && prevClose > 0) {
          const diff = price - prevClose;
          const pct = (diff / prevClose) * 100;
          const sign = diff >= 0 ? '+' : '';
          changeStr = ` | Change: ${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%) vs Prev Close ${prevClose.toFixed(2)}`;
        }
        const rangeStr =
          typeof low === 'number' && typeof high === 'number'
            ? ` | Day Range: ${low.toFixed(2)} - ${high.toFixed(2)} ${currency}`
            : '';

        return {
          title: `Live Market Quote: ${t.label} — ${price.toFixed(2)} ${currency}`,
          url: t.url,
          snippet: `Current Live Price: ${price.toFixed(2)} ${currency}${changeStr}${rangeStr} (As of ${marketTime}).`,
          publishedDate: marketTime,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return results.filter((r): r is OmniSearchResultItem => r !== null);
}

/**
 * Fetches live web & news search results from Google News RSS as a resilient fallback.
 */
async function fetchLiveWebBackupResults(
  query: string,
  maxResults = 6,
): Promise<OmniSearchResultItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const xml = await res.text();

    const items: OmniSearchResultItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while (
      (match = itemRegex.exec(xml)) !== null &&
      items.length < maxResults
    ) {
      const block = match[1];
      const titleMatch =
        /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i.exec(
          block,
        );
      const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(block);
      const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block);
      const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(block);

      const rawTitle = (titleMatch?.[1] ?? titleMatch?.[2] ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      const url = (linkMatch?.[1] ?? '').trim();
      const pubDate = (pubDateMatch?.[1] ?? '').trim();
      const sourceName = (sourceMatch?.[1] ?? '').trim();

      if (rawTitle) {
        items.push({
          title: rawTitle,
          url,
          snippet: sourceName
            ? `Published by ${sourceName}${pubDate ? ` on ${pubDate}` : ''}: ${rawTitle}`
            : rawTitle,
          publishedDate: pubDate || undefined,
        });
      }
    }

    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes a live web search via OmniRoute's `/v1/search` endpoint (Tavily, Serper, SearXNG)
 * with automatic API key rotation and safe fallback.
 */
export async function executeOmniRouteSearch(options: {
  query: string;
  searchType?: 'web' | 'news';
  maxResults?: number;
  baseUrl: string;
  apiKeys: string[];
}): Promise<OmniSearchResponse> {
  const { query, maxResults = 6, baseUrl, apiKeys } = options;

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const searchEndpoint = `${cleanBaseUrl}/search`;

  const marketQuotesPromise = fetchLiveMarketQuotes(query).catch(() => []);

  let omniResponse: OmniSearchResponse | null = null;

  for (const apiKey of apiKeys) {
    try {
      omniResponse = await Promise.any(
        OMNIROUTE_SEARCH_PROVIDERS.map((provider) =>
          postSingleOmniSearch({
            searchEndpoint,
            apiKey,
            query,
            maxResults,
            provider,
          }),
        ),
      );
      if (omniResponse) break;
    } catch {
      // Rotate to next API key
    }
  }

  const marketQuotes = await marketQuotesPromise;

  if (omniResponse && (omniResponse.results.length > 0 || omniResponse.answer)) {
    return {
      ...omniResponse,
      results: [...marketQuotes, ...omniResponse.results].slice(
        0,
        maxResults + marketQuotes.length,
      ),
    };
  }

  const webBackup = await fetchLiveWebBackupResults(query, maxResults).catch(
    () => [],
  );
  const combinedResults = [...marketQuotes, ...webBackup];

  return {
    query,
    provider:
      marketQuotes.length > 0
        ? 'omniroute-live-market+web'
        : 'omniroute-web-search',
    answer:
      marketQuotes.length > 0
        ? marketQuotes.map((q) => `${q.title} (${q.snippet})`).join(' | ')
        : null,
    results: combinedResults,
  };
}

export function formatSearchResultsForAgent(
  searchRes: OmniSearchResponse,
): string {
  const lines: string[] = [
    `[LIVE WEB SEARCH RESULTS | Query: "${searchRes.query}" | Source: ${searchRes.provider} | Retrieved: ${new Date().toUTCString()}]`,
  ];

  if (searchRes.answer) {
    lines.push(`Live Summary: ${searchRes.answer}`);
  }

  if (searchRes.results.length === 0 && !searchRes.answer) {
    lines.push('No live search results were returned for this query.');
    return lines.join('\n');
  }

  searchRes.results.forEach((item, idx) => {
    const datePart = item.publishedDate ? ` (${item.publishedDate})` : '';
    const urlPart = item.url ? ` — ${item.url}` : '';
    lines.push(`${idx + 1}. **${item.title}**${datePart}${urlPart}`);
    if (item.snippet) {
      lines.push(`   ${item.snippet}`);
    }
  });

  return lines.join('\n');
}
