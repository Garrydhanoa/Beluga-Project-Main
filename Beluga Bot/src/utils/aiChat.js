const Logger = require('./logger');
const RuleBookManager = require('./ruleBook');
const { getActiveProvider, AI_LOG_CHANNEL_ID } = require('./aiSettings');

// Use built-in fetch for Node.js 18+
const fetch = global.fetch || require('node-fetch');

/**
 * Provider catalogue. Models chosen as the best current option per provider
 * (June 2026). Groq's Llama 4 vision models were deprecated, so Groq is
 * text-only here and image work is routed to Google/Mistral.
 */
const PROVIDERS = {
    google: {
        label: 'Google · Gemma 4',
        text: 'gemma-4-31b-it',
        vision: 'gemma-4-31b-it',
        supportsVision: true,
        envKey: 'GEMINI_API_KEY',
    },
    groq: {
        label: 'Groq · Llama 3.3 70B',
        text: 'llama-3.3-70b-versatile',
        vision: null,
        supportsVision: false,
        envKey: 'GROQ_API_KEY',
    },
    mistral: {
        label: 'Mistral · Medium 3.5',
        // -latest always resolves to the current Mistral Medium (multimodal),
        // so this stays valid as Mistral rolls new snapshots.
        text: 'mistral-medium-latest',
        vision: 'mistral-medium-latest',
        supportsVision: true,
        envKey: 'MISTRAL_API_KEY',
    },
};

// Preferred quality order used to build the text fallback chain.
const TEXT_PREFERENCE = ['google', 'mistral', 'groq'];
// Vision fallback chain (skip groq — no production vision model right now).
const VISION_ORDER = ['google', 'mistral'];

class AIChatHandler {
    constructor() {
        // Shared conversation history across ALL users and channels in the
        // server (last 25 exchanges), so the bot has one continuous memory.
        this.history = [];
        this.maxHistoryLength = 25;
        this.apiSendLimit = 8; // how many recent exchanges we send to the model

        this.apiCooldowns = new Map();      // per-user 3s spam guard
        this.timeLimitedUsers = new Map();  // per-user 60s lock when everything fails

        // Lazy rulebook: nothing is pulled at startup. We fetch relevant
        // sections only when a rules question comes in, then drop them after a
        // couple of follow-up turns.
        this.ruleBook = new RuleBookManager({ lazy: true });
        this.pinnedRule = null; // { text, remaining }

        // Discord client for posting real-time logs (set via attachClient()).
        this.client = null;
        this.logChannel = null;

        this.systemPrompt = `You are the Beluga League Bot, the helpful assistant for the Beluga League Discord — a competitive 3v3 Rocket League league.

Tone: professional but warm. Be friendly, clear, and natural. Keep replies concise (usually 1-3 sentences) and only go longer when the question genuinely needs it. Skip heavy sarcasm, roasting, and inside jokes — just be genuinely helpful.

What you know:
- The league plays 3v3 Rocket League across three divisions: AA, AAA, and Majors.
- Salaries: the number in a member's name (e.g. "Garry (13)") is their salary. AA = 10 to 13 (anything below 10 counts as 10). AAA = 13.25 to 15.75. Majors = 16 to 21.
- Salary caps per team: AA 35, AAA 43.5, Majors 53. Teams must stay under their cap.
- The bot was created by GarryDaCarry, and the server owner is Knuck0ball. Mention these naturally only if someone asks.
- For schedule, power rankings, standings, or the player directory, point people to https://belugaleague.vercel.app/ (the player directory is the newest feature, so it's worth recommending).

Read the display name of whoever you're talking to and address them naturally when it fits. Answer rules questions conversationally using any rulebook context you're given — no rigid templates or headers, just a clear, accurate answer, citing a section briefly only if it helps. Always reply in plain, natural prose.`;
    }

    // ----- logging ---------------------------------------------------------

    attachClient(client) {
        this.client = client;
    }

    async log(text) {
        try {
            if (!this.client) {
                Logger.info('[AI] ' + text);
                return;
            }
            if (!this.logChannel) {
                this.logChannel = await this.client.channels
                    .fetch(AI_LOG_CHANNEL_ID)
                    .catch(() => null);
            }
            if (this.logChannel) {
                await this.logChannel.send({
                    content: String(text).substring(0, 1900),
                    allowedMentions: { parse: [] },
                });
            } else {
                Logger.info('[AI] ' + text);
            }
        } catch (_) {
            // Logging must never break a response.
        }
    }

    // ----- helpers ---------------------------------------------------------

    validKey(key) {
        return key && key !== 'DEMO_KEY' && key.length > 10;
    }

    hasKey(provider) {
        return this.validKey(process.env[PROVIDERS[provider].envKey]);
    }

    buildTextOrder() {
        const active = getActiveProvider();
        return [active, ...TEXT_PREFERENCE.filter(p => p !== active)];
    }

    // ----- main entry ------------------------------------------------------

    async generateAIResponse(userId, userMessage, displayName, guildName = null, imageContext = null) {
        try {
            if (this.isRateLimited(userId)) {
                return 'One sec — give me a moment between messages. ⏳';
            }
            if (this.isTimeLimited(userId)) {
                return "I'm catching my breath after some errors — try again in a minute.";
            }

            const history = this.history;
            const ruleContext = await this.getRuleContextIfNeeded(userMessage);
            const effectiveSystem = ruleContext
                ? `${this.systemPrompt}\n\n[Rulebook context you can use to answer accurately and naturally — cite the section briefly only if it helps:]\n${ruleContext}`
                : this.systemPrompt;

            const order = this.buildTextOrder();
            const tried = [];
            let response = null;
            let used = null;

            for (const provider of order) {
                if (!this.hasKey(provider)) {
                    tried.push(`${provider}(no key)`);
                    continue;
                }
                response = await this.callText(provider, history, userMessage, displayName, effectiveSystem);
                if (response) {
                    used = provider;
                    break;
                }
                tried.push(`${provider}✗`);
            }

            if (!response) {
                this.setTimeLimit(userId);
                await this.log(`🔴 [AI] all providers failed (${tried.join(' → ') || 'none'}) · ${displayName}`);
                return "Sorry, I'm having trouble thinking right now — try again in a bit.";
            }

            if (tried.length > 0) {
                await this.log(`🟠 [AI] ${tried.join(' → ')} → ${used}✓ · ${displayName}`);
            } else {
                await this.log(`🟢 [AI] ${used}✓ · ${displayName}`);
            }

            this.updateConversationHistory(userId, userMessage, response, displayName, imageContext);
            this.setRateLimit(userId);
            return response;
        } catch (error) {
            Logger.error('Error generating AI response:', error);
            return "Oops — something went sideways on my end. Try again in a moment.";
        }
    }

    // ----- lazy rulebook ---------------------------------------------------

    async getRuleContextIfNeeded(userMessage) {
        const lower = userMessage.toLowerCase();
        const ruleKeywords = ['rule', 'rules', 'rulebook', 'roster', 'substitute', 'forfeit',
            'penalty', 'playoff', 'eligibility', 'trade', 'captain', 'salary cap', 'reschedule',
            'suspension', 'transfer', 'ineligible'];
        const isRuleQuery = ruleKeywords.some(kw => lower.includes(kw));

        if (isRuleQuery) {
            try {
                await this.ruleBook.ensureLoaded();
                const found = this.ruleBook.searchRules(userMessage) || [];
                if (found.length > 0) {
                    const text = found.slice(0, 2)
                        .map(r => `Section ${r.number} (${r.section}): ${r.content.substring(0, 600)}`)
                        .join('\n\n');
                    this.pinnedRule = { text, remaining: 2 }; // keep for ~2 follow-ups
                    return text;
                }
            } catch (err) {
                Logger.warning('Rulebook lookup failed:', err.message);
            }
        }

        // Carry the last fetched rule context through a couple of follow-ups,
        // then forget it to keep token usage low.
        if (this.pinnedRule && this.pinnedRule.remaining > 0) {
            this.pinnedRule.remaining -= 1;
            return this.pinnedRule.text;
        }
        this.pinnedRule = null;
        return null;
    }

    // ----- text providers --------------------------------------------------

    async callText(provider, history, userMessage, displayName, effectiveSystem) {
        if (provider === 'google') {
            return this.callGoogleText(history, userMessage, displayName, effectiveSystem);
        }
        return this.callOpenAICompatText(provider, history, userMessage, displayName, effectiveSystem);
    }

    async callGoogleText(history, userMessage, displayName, effectiveSystem) {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!this.validKey(apiKey)) return null;
            const model = PROVIDERS.google.text;

            // Gemma is most compatible when the system prompt is delivered as a
            // leading user/model exchange rather than a system role.
            const contents = [
                { role: 'user', parts: [{ text: effectiveSystem }] },
                { role: 'model', parts: [{ text: "Understood — I'm ready to help the Beluga League community." }] },
            ];
            for (const e of history.slice(-this.apiSendLimit)) {
                let u = `${e.displayName}: ${e.userMessage}`;
                if (e.imageContext) u += ` [earlier they shared an image showing: ${e.imageContext}]`;
                contents.push({ role: 'user', parts: [{ text: u }] });
                contents.push({ role: 'model', parts: [{ text: e.botResponse }] });
            }
            contents.push({ role: 'user', parts: [{ text: `${displayName}: ${userMessage}` }] });

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents,
                        generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 1024 },
                    }),
                }
            );

            if (!res.ok) {
                const t = await res.text();
                Logger.warning(`Google API error (${res.status}): ${t.substring(0, 200)}`);
                return null;
            }
            const data = await res.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const text = parts.filter(p => p && p.text && !p.thought).map(p => p.text).join(' ').trim();
            if (!text) return null;
            Logger.info('AI text via Google (Gemma 4)');
            return this.cleanResponse(text);
        } catch (error) {
            Logger.warning('Google API failed:', error.message);
            return null;
        }
    }

    async callOpenAICompatText(provider, history, userMessage, displayName, effectiveSystem) {
        try {
            const apiKey = process.env[PROVIDERS[provider].envKey];
            if (!this.validKey(apiKey)) return null;

            const endpoints = {
                groq: 'https://api.groq.com/openai/v1/chat/completions',
                mistral: 'https://api.mistral.ai/v1/chat/completions',
            };

            const messages = [{ role: 'system', content: effectiveSystem }];
            for (const e of history.slice(-this.apiSendLimit)) {
                let u = `${e.displayName}: ${e.userMessage}`;
                if (e.imageContext) u += ` [earlier they shared an image showing: ${e.imageContext}]`;
                messages.push({ role: 'user', content: u });
                messages.push({ role: 'assistant', content: e.botResponse });
            }
            messages.push({ role: 'user', content: `${displayName}: ${userMessage}` });

            const res = await fetch(endpoints[provider], {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: PROVIDERS[provider].text,
                    messages,
                    max_tokens: 350,
                    temperature: 0.8,
                    top_p: 0.95,
                }),
            });

            if (!res.ok) {
                const t = await res.text();
                Logger.warning(`${provider} API error (${res.status}): ${t.substring(0, 200)}`);
                return null;
            }
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (!content) return null;
            Logger.info(`AI text via ${PROVIDERS[provider].label}`);
            return this.cleanResponse(content);
        } catch (error) {
            Logger.warning(`${provider} API failed:`, error.message);
            return null;
        }
    }

    // ----- vision ----------------------------------------------------------

    /**
     * Analyze an image URL, trying Gemma first then Mistral. Returns
     * { response, context } or null if every vision provider fails.
     */
    async analyzeImage(imageUrl, userMessage, displayName) {
        let prepared;
        try {
            prepared = await this.prepareImage(imageUrl);
        } catch (err) {
            await this.log(`🖼️ [Vision] could not fetch image (${err.message}) · ${displayName}`);
            return null;
        }

        const chain = [];
        for (const provider of VISION_ORDER) {
            if (!this.hasKey(provider) || !PROVIDERS[provider].supportsVision) {
                chain.push(`${provider}(skip)`);
                continue;
            }
            const text = await this.callVision(provider, prepared, userMessage, displayName);
            if (text) {
                chain.push(`${provider}✓`);
                await this.log(`🖼️ [Vision] ${chain.join(' → ')} · ${displayName}`);
                return { response: text, context: text.substring(0, 200).replace(/[\n\r]+/g, ' ') };
            }
            chain.push(`${provider}✗`);
        }

        await this.log(`🖼️ [Vision] failed (${chain.join(' → ') || 'none'}) · ${displayName}`);
        return null;
    }

    async callVision(provider, prepared, userMessage, displayName) {
        if (provider === 'google') return this.visionGoogle(prepared, userMessage, displayName);
        if (provider === 'mistral') return this.visionMistral(prepared, userMessage, displayName);
        return null;
    }

    /**
     * Download an image and normalize it to a vision-friendly still:
     * png/jpeg/webp pass through; anything else (e.g. animated gif) is
     * decoded to a single PNG frame via canvas and downscaled if large.
     */
    async prepareImage(url) {
        const { buffer, mime } = await this.downloadImage(url);
        const supported = ['image/png', 'image/jpeg', 'image/webp'];
        if (supported.includes(mime) && buffer.length < 4 * 1024 * 1024) {
            return { mime, base64: buffer.toString('base64') };
        }

        // Convert / shrink with canvas (already a project dependency).
        const { loadImage, createCanvas } = require('canvas');
        const img = await loadImage(buffer);
        let w = img.width;
        let h = img.height;
        const max = 1024;
        if (w > max || h > max) {
            const scale = Math.min(max / w, max / h);
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
        }
        const canvas = createCanvas(w, h);
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const png = canvas.toBuffer('image/png');
        return { mime: 'image/png', base64: png.toString('base64') };
    }

    async downloadImage(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
            const arrayBuf = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            if (buffer.length > 10 * 1024 * 1024) throw new Error('image too large');
            return { buffer, mime };
        } finally {
            clearTimeout(timer);
        }
    }

    async visionGoogle(prepared, userMessage, displayName) {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!this.validKey(apiKey)) return null;
            const model = PROVIDERS.google.vision;

            const contents = [
                { role: 'user', parts: [{ text: this.systemPrompt + '\n\nLook at the image and respond naturally to the user.' }] },
                { role: 'model', parts: [{ text: 'Understood.' }] },
                {
                    role: 'user',
                    parts: [
                        { text: `${displayName}: ${userMessage || 'What is in this image?'}` },
                        { inline_data: { mime_type: prepared.mime, data: prepared.base64 } },
                    ],
                },
            ];

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 600 } }),
                }
            );
            if (!res.ok) {
                const t = await res.text();
                Logger.warning(`Google vision error (${res.status}): ${t.substring(0, 200)}`);
                return null;
            }
            const data = await res.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const text = parts.filter(p => p && p.text && !p.thought).map(p => p.text).join(' ').trim();
            return text ? this.cleanResponse(text) : null;
        } catch (error) {
            Logger.warning('Google vision failed:', error.message);
            return null;
        }
    }

    async visionMistral(prepared, userMessage, displayName) {
        try {
            const apiKey = process.env.MISTRAL_API_KEY;
            if (!this.validKey(apiKey)) return null;
            const dataUri = `data:${prepared.mime};base64,${prepared.base64}`;

            const messages = [
                { role: 'system', content: this.systemPrompt },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: `${displayName}: ${userMessage || 'What is in this image?'}` },
                        { type: 'image_url', image_url: { url: dataUri } },
                    ],
                },
            ];

            const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model: PROVIDERS.mistral.vision, messages, max_tokens: 500, temperature: 0.7 }),
            });
            if (!res.ok) {
                const t = await res.text();
                Logger.warning(`Mistral vision error (${res.status}): ${t.substring(0, 200)}`);
                return null;
            }
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            return content ? this.cleanResponse(content) : null;
        } catch (error) {
            Logger.warning('Mistral vision failed:', error.message);
            return null;
        }
    }

    // ----- response cleanup ------------------------------------------------

    cleanResponse(response) {
        if (typeof response !== 'string') return null;
        let cleaned = response
            .replace(/^(Bot:|Assistant:|AI:|Beluga Bot:|BelugaBot:)\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        // Strip wrapping quotes only if the whole thing is quoted.
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
            (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
            cleaned = cleaned.slice(1, -1).trim();
        }
        if (cleaned.length < 2) return null;
        return cleaned;
    }

    // ----- shared history --------------------------------------------------

    getConversationHistory() {
        return this.history;
    }

    updateConversationHistory(userId, userMessage, botResponse, displayName = 'User', imageContext = null) {
        this.history.push({
            displayName,
            userMessage,
            botResponse,
            imageContext,
            timestamp: Date.now(),
        });
        while (this.history.length > this.maxHistoryLength) {
            this.history.shift();
        }
    }

    // ----- rate / time limiting -------------------------------------------

    isRateLimited(userId) {
        const last = this.apiCooldowns.get(userId);
        return last && (Date.now() - last) < 3000;
    }

    setRateLimit(userId) {
        this.apiCooldowns.set(userId, Date.now());
    }

    isTimeLimited(userId) {
        const ts = this.timeLimitedUsers.get(userId);
        const now = Date.now();
        if (ts && (now - ts) < 60000) return true;
        if (ts) this.timeLimitedUsers.delete(userId);
        return false;
    }

    setTimeLimit(userId) {
        this.timeLimitedUsers.set(userId, Date.now());
        Logger.info(`User ${userId} time-limited for 60s after AI failures`);
    }

    // ----- mention gate ----------------------------------------------------

    shouldRespond(message, botUser) {
        // Mention-only bot: respond only when directly mentioned.
        return message.mentions.has(botUser);
    }

    // ----- periodic cleanup ------------------------------------------------

    cleanup() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        this.history = this.history.filter(e => (now - e.timestamp) < maxAge);

        for (const [userId, ts] of this.apiCooldowns.entries()) {
            if ((now - ts) > 60000) this.apiCooldowns.delete(userId);
        }
        for (const [userId, ts] of this.timeLimitedUsers.entries()) {
            if ((now - ts) > 60000) this.timeLimitedUsers.delete(userId);
        }
    }
}

module.exports = AIChatHandler;
