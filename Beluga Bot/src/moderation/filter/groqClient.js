/**
 * Groq chat completions for the chat filter. aiChat.callText doesn't fit: it has a
 * high temperature, a fixed model, and returns null on any failure, which would hide
 * the rate limits this layer has to react to.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 20 * 1000;

class GroqError extends Error {
    constructor(message, status, retryAfter = null) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

function available() {
    return !!process.env.GROQ_API_KEY;
}

/** @returns {Promise<{text:string, tokens:number}>} */
async function complete({ model, system, user, maxTokens = 900 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: maxTokens,
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            const retryAfter = parseInt(res.headers.get('retry-after') || '', 10) || null;
            const body = (await res.text()).slice(0, 200);
            throw new GroqError(`Groq returned ${res.status}: ${body}`, res.status, retryAfter);
        }
        const json = await res.json();
        return { text: json.choices?.[0]?.message?.content || '', tokens: json.usage?.total_tokens || 0 };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { available, complete, GroqError };
