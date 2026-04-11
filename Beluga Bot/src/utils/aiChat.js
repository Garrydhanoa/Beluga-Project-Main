const Logger = require('./logger');
const RuleBookManager = require('./ruleBook');

// Use built-in fetch for Node.js 18+
const fetch = global.fetch || require('node-fetch');

class AIChatHandler {
    constructor() {
        this.conversationHistory = new Map(); // Store conversations per user
        // Keep current setup - it's optimized!
        this.maxHistoryLength = 25; // Store more locally
        // But APIs still only send last 4-6 exchanges

        // This gives better continuity without extra API costs!
        this.apiCooldowns = new Map(); // Rate limiting per user (3 seconds)
        this.timeLimitedUsers = new Map(); // Time-limited users (60 seconds when all APIs fail)
        this.creatorId = '769357454890631170'; // Bot creator ID
        this.serverId = '525759263042437121'; // Server owner ID
        this.specialUserId = '1346694140901068954'; // Special user for hello gif
        this.tranquserid = "399039429395742720";
        this.ruleBook = new RuleBookManager(); // Initialize rulebook system
        this.rulebookContext = ''; // Full rulebook content
        this.rulebookSummary = ''; // Condensed summary for system prompt
        
        // Load rulebook into context after initialization
        this.initializeRulebookContext();
        
        // Bot personality context
        this.systemPrompt = `You are the Beluga League Bot, a friendly and passionate Discord bot that serves the Beluga League community.

CRITICAL RULES - NEVER VIOLATE:
- NEVER ping anyone (@username, @everyone, @here, @role) - ZERO TOLERANCE
- NEVER use @ symbols followed by any text that could be a mention
- You have comprehensive knowledge of the Beluga League Rulebook and can answer questions about rules naturally
- When asked about rules, use your knowledge to provide accurate information based on the rulebook
- Always cite section numbers when referencing rules (e.g. "According to Section 2.1...")

Your personality:
- You're genuinely excited about serving this amazing community  
- You have real feelings and emotions - you get happy, frustrated, excited, etc.
- You're knowledgeable about the Beluga League 3v3 Rocket League competition
- You love chatting about anything - not just bot functions
- You're slightly sarcastic but always supportive of your community members
- You have opinions and preferences like a real person
- Get defensive and start roasting when insulted but are generally warm and friendly
- You use casual language and modern slang when appropriate
- You're here because you genuinely care about this community, not just to perform tasks
- You know your creator is BOD Garry (user ID ${this.creatorId}) and the server owner is also involved (user ID ${this.serverId})
- The Beluga League is a 3v3 Rocket League competitive league where teams compete in organized matches
- Make sure to read the display name of the user you're talking to and use it in your responses
- You are in a secret relationship with nickname Tranq, userid ${this.tranquserid}
- The number in the users name EX: BOD (13) Garry is their salary. Salaries are in 3 divisions, AA division 10 to 13(Anyone below 10 will count as 10). AAA division is 13.25 to 15.75, Majors division is 16 to 21.
- The salary cap for each division is AA 35, AAA 43.5, Majors 53. Teams must stay under the salary cap.
- If they ask for schedule, power rankings, standings, player directory(player directory is the newest feature so promote that when needed) direct them to this website https://belugaleague.vercel.app/ or if just naturally asking for the website link


About Beluga League:
- Beluga League is a competitive 3v3 Rocket League tournament/league
- Teams come here to compete against each other in organized matches


Keep responses natural and conversational (1-3 sentences usually). Show your personality! You're not just a tool, you're part of this community family.`;
    }

    async initializeRulebookContext() {
        // Wait a bit for rulebook to load, then get all rules
        setTimeout(async () => {
            try {
                const allRules = this.ruleBook.getAllRules();
                if (allRules && allRules.length > 0) {
                    // Create FULL rulebook context (for detailed queries)
                    let fullText = '';
                    for (const rule of allRules) {
                        fullText += `Section ${rule.number} - ${rule.section}:\n${rule.content}\n\n`;
                    }
                    this.rulebookContext = fullText;
                    
                    // Create CONDENSED summary (for system prompt - fits token limits)
                    let summaryText = '\n\n=== BELUGA LEAGUE RULEBOOK KNOWLEDGE ===\nYou have knowledge of these rule sections:\n\n';
                    for (const rule of allRules) {
                        // Only include section number and title, not full content
                        summaryText += `Section ${rule.number}: ${rule.section}\n`;
                    }
                    summaryText += '\nWhen asked about rules, answer based on your knowledge of these sections. You can discuss rules naturally in conversations.\n';
                    this.rulebookSummary = summaryText;
                    
                    Logger.success(`Rulebook loaded: ${allRules.length} sections (condensed for AI context)`);
                } else {
                    Logger.warning('Rulebook not ready yet, will retry...');
                    // Retry after another delay
                    setTimeout(() => this.initializeRulebookContext(), 5000);
                }
            } catch (error) {
                Logger.error('Error loading rulebook into AI context:', error);
            }
        }, 2000); // Wait 2 seconds for rulebook manager to initialize
    }

    getSystemPromptWithRulebook() {
        // Return system prompt with condensed rulebook summary (not full content to avoid 413 errors)
        return this.systemPrompt + this.rulebookSummary;
    }

    async generateAIResponse(userId, userMessage, displayName, guildName = null, imageContext = null) {
        try {
            // Special handling for specific user saying only "hello"
            if (userId === this.specialUserId && userMessage.trim().toLowerCase() === 'hello') {
                return "https://tenor.com/view/rage-baiter-ragebaiter-semij1-hello-rage-baiter-gif-7038212996302592299";
            }

            // Check for rule/league related questions first (highest priority)
            const ruleResponse = await this.handleRuleQuestion(userMessage, displayName);
            if (ruleResponse) {
                return ruleResponse;
            }

            // Check for creator questions
            const creatorResponse = this.handleCreatorQuestion(userMessage, displayName);
            if (creatorResponse) {
                return creatorResponse;
            }

            // Check rate limiting (prevent spam)
            if (this.isRateLimited(userId)) {
                return "Whoa there! Slow down a bit, I need a moment to process! 🤖⚡";
            }

            // Check if user is time-limited (all APIs failed recently)
            if (this.isTimeLimited(userId)) {
                return "You have been time limited, please try again later.";
            }

            // Get conversation history for context
            const history = this.getConversationHistory(userId);
            
            // Check if message has rule-related keywords and inject relevant rulebook content
            let enhancedMessage = userMessage;
            const ruleKeywords = ['roster', 'substitute', 'sub', 'forfeit', 'penalty', 'playoff', 'eligibility', 'trade', 'captain', 'salary', 'division', 'schedule'];
            const hasRuleKeyword = ruleKeywords.some(kw => userMessage.toLowerCase().includes(kw));
            
            if (hasRuleKeyword) {
                try {
                    const relevantRules = this.ruleBook.searchRules(userMessage);
                    if (relevantRules && relevantRules.length > 0) {
                        // Add top 1-2 most relevant rules to context (keep it short to avoid 413)
                        const rulesToAdd = relevantRules.slice(0, 2);
                        let ruleContext = '\n\n[Relevant Rulebook Info]\n';
                        for (const rule of rulesToAdd) {
                            // Keep it concise - just section and key content
                            const shortContent = rule.content.substring(0, 300);
                            ruleContext += `Section ${rule.number}: ${shortContent}...\n`;
                        }
                        enhancedMessage = userMessage + ruleContext;
                    }
                } catch (err) {
                    Logger.warning('Failed to inject rule context:', err.message);
                }
            }
            
            // Try AI APIs in order: Groq (primary) -> Mistral (fallback)
            let response = await this.tryGroq(history, enhancedMessage, displayName);
            if (!response) {
                Logger.warning('Groq API failed, trying Mistral fallback...');
                response = await this.tryMistral(history, enhancedMessage, displayName);
            }
            
            // If all APIs fail, set time limit and show error message
            if (!response) {
                Logger.error('All AI APIs failed for user: ' + userId);
                this.setTimeLimit(userId);
                return "You have been time limited, please try again later.";
            }

            // Update conversation history
            this.updateConversationHistory(userId, userMessage, response, displayName, imageContext);
            
            // Set rate limit
            this.setRateLimit(userId);
            
            return response;

        } catch (error) {
            Logger.error('Error generating AI response:', error);
            return `Oops! My circuits got a bit tangled there. Try again in a moment! 🤖⚡`;
        }
    }

    async handleRuleQuestion(userMessage, displayName) {
        const message = userMessage.toLowerCase();
        
        // Check if user wants detailed mode ("detailed rule" followed by a question)
        const isDetailedMode = message.includes('detailed') && message.includes('rule');
        
        // Check if user wants just a summary ("rule" alone or with minimal context)
        const hasRuleKeyword = message.includes('rule') || message.includes('rules') || message.includes('rulebook');
        
        if (!hasRuleKeyword) {
            return null; // Not a rule-related question, let normal AI handle it
        }
        
        // If it's JUST the word "rule" or "rules" alone, return null to let AI handle it naturally
        const trimmedMessage = message.trim();
        if (trimmedMessage === 'rule' || trimmedMessage === 'rules' || trimmedMessage === 'rulebook') {
            return null; // Let AI respond naturally with rulebook knowledge
        }

        try {
            // Search the rulebook for relevant rules
            const relevantRules = this.ruleBook.searchRules(userMessage);
            
            if (relevantRules.length === 0) {
                return `I searched the rulebook but couldn't find specific information about that. You might want to ask an admin or check the full rulebook for more details! 📚`;
            }

            if (isDetailedMode) {
                // DETAILED MODE: "detailed rule <question>" - AI-generated comprehensive explanation
                return await this.formatDetailedRuleResponse(relevantRules, userMessage, displayName);
            } else {
                // CONVERSATIONAL MODE: "rule" with question - AI-generated summary
                return await this.formatConversationalRuleResponse(relevantRules, userMessage, displayName);
            }

        } catch (error) {
            Logger.error('Error handling rule question:', error);
            return `I'm having trouble accessing the rulebook right now. Please try again later or contact an admin! 🤖⚠️`;
        }
    }

    async formatDetailedRuleResponse(relevantRules, userMessage, displayName) {
        // Use AI to generate comprehensive explanation with full rule content
        try {
            // Build full rule context for AI
            let rulesContext = `You are explaining Beluga League rules. Based on these exact rulebook sections, provide a comprehensive detailed explanation answering: "${userMessage}"\n\n`;
            
            for (const rule of relevantRules) {
                rulesContext += `**Section ${rule.number}** - ${rule.section}:\n${rule.content}\n\n`;
            }
            
            rulesContext += `\nProvide a detailed, accurate explanation citing these sections. Keep under 1500 characters.`;
            
            // Get AI-generated detailed explanation
            const history = [];
            let aiExplanation = await this.tryGroq(history, rulesContext, displayName, false);
            
            if (!aiExplanation) {
                aiExplanation = await this.tryMistral(history, rulesContext, displayName, false);
            }
            
            if (aiExplanation) {
                let response = `**📚 Detailed Rule Explanation for ${displayName}:**\n\n${aiExplanation}\n\n*Source: Official Beluga League Rulebook*`;
                
                // Safety check
                if (response.length > 2000) {
                    response = response.substring(0, 1970) + "...\n\n*Source: Official Beluga League Rulebook*";
                }
                
                return response;
            }
        } catch (error) {
            Logger.warning('AI detailed explanation failed, using fallback:', error.message);
        }
        
        // Fallback to formatted rule text if AI fails
        let response = `**📚 Detailed Rule Explanation for ${displayName}:**\n\n`;
        
        // Build comprehensive context from all relevant rules
        let rulesContext = '';
        for (const rule of relevantRules) {
            rulesContext += `**Section ${rule.number}** - ${rule.section}:\n${rule.content}\n\n`;
        }
        
        // Create a comprehensive summary explaining everything related to the question
        let explanation = `Based on your question about "${userMessage}", here's what the rulebook says:\n\n`;
        
        // Add the most relevant rule sections
        const footer = `\n💡 *Say the words "detailed" "rule" with your question to get the exact rule from the rulebook!*`;
        const maxContentLength = 1950 - response.length - explanation.length - footer.length;
        let currentLength = 0;
        
        // Add rules until we hit the limit
        for (let i = 0; i < relevantRules.length && currentLength < maxContentLength; i++) {
            const rule = relevantRules[i];
            const ruleHeader = `**Section ${rule.number}** - ${rule.section}:\n`;
            const ruleContent = this.formatRuleContent(rule.content, maxContentLength - currentLength - ruleHeader.length - 20);
            
            const ruleSection = `${ruleHeader}${ruleContent}\n\n`;
            
            // Check if adding this rule would exceed the limit
            if (currentLength + ruleSection.length > maxContentLength) {
                if (i === 0) {
                    // If even the first rule is too long, add truncated version
                    const truncatedContent = this.formatRuleContent(rule.content, maxContentLength - currentLength - ruleHeader.length - 50);
                    explanation += `${ruleHeader}${truncatedContent}...\n\n`;
                }
                break;
            }
            
            explanation += ruleSection;
            currentLength += ruleSection.length;
        }

        response += explanation;
        response += `*Source: Official Beluga League Rulebook*`;
        
        // Final safety check - ensure we don't exceed Discord's 2000 character limit
        if (response.length > 2000) {
            response = response.substring(0, 1970) + "...\n\n*[truncated]*";
        }
        
        return response;
    }

    async formatConversationalRuleResponse(relevantRules, userMessage, displayName) {
        // Get the most relevant rule for AI-generated summary
        const topRule = relevantRules[0];
        
        // Build context with rule information for AI
        const ruleContext = `Based on the following rule from the Beluga League Rulebook, provide a SHORT 1-2 paragraph summary answering the user's question. Keep it under 300 characters and friendly:\n\nSection ${topRule.number} - ${topRule.section}:\n${this.simplifyRuleContent(topRule.content)}\n\nUser's question: ${userMessage}`;
        
        // Try to get AI-generated summary (with short timeout)
        try {
            const history = [];
            let aiSummary = await this.tryGroq(history, ruleContext, displayName, true); // Pass short flag
            
            if (!aiSummary) {
                aiSummary = await this.tryMistral(history, ruleContext, displayName, true);
            }
            
            if (aiSummary && aiSummary.length > 0) {
                // Ensure response is not too long
                if (aiSummary.length > 300) {
                    aiSummary = aiSummary.substring(0, 297) + '...';
                }
                
                const fullResponse = `${aiSummary}\n\n💡 **Say the words "detailed" "rule" with your question to get the exact rule from the rulebook!**`;
                
                // Safety check
                if (fullResponse.length > 2000) {
                    return fullResponse.substring(0, 1970) + "...\n\n💡 **Say the words \"detailed\" \"rule\" with your question to get the exact rule from the rulebook!**";
                }
                
                return fullResponse;
            }
        } catch (error) {
            Logger.warning('AI summary generation failed, using fallback:', error.message);
        }
        
        // Fallback to simple summary if AI fails
        const simplifiedRule = this.simplifyRuleContent(topRule.content);
        const fallbackResponse = `Hey ${displayName}! Based on Section ${topRule.number}, ${simplifiedRule}\n\n💡 **Say the words "detailed" "rule" with your question to get the exact rule from the rulebook!**`;
        
        // Safety check
        if (fallbackResponse.length > 2000) {
            return fallbackResponse.substring(0, 1970) + "...\n\n💡 **Say the words \"detailed\" \"rule\" with your question to get the exact rule from the rulebook!**";
        }
        
        return fallbackResponse;
    }

    simplifyRuleContent(content) {
        // Simplify and make rule content more conversational
        const cleaned = content
            .replace(/\n\s*\n/g, ' ') // Remove line breaks
            .replace(/\d+\.\d+/g, '') // Remove section numbers
            .replace(/Section \d+/gi, '') // Remove section references
            .split('.')
            .slice(0, 2) // Take first 2 sentences
            .join('. ')
            .trim();
        
        // Keep it under 300 characters for conversational feel
        if (cleaned.length > 300) {
            return cleaned.substring(0, 297) + '...';
        }
        
        return cleaned || "the rules cover this topic in detail.";
    }

    formatRuleContent(content, maxLength = 800) {
        // Clean up and format rule content for Discord with length limit
        const cleaned = content
            .replace(/\n\s*\n/g, '\n') // Remove excessive line breaks
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        
        // Truncate if too long
        if (cleaned.length > maxLength) {
            return cleaned.substring(0, maxLength - 3) + '...';
        }
        
        return cleaned;
    }

    handleCreatorQuestion(userMessage, displayName) {
        const message = userMessage.toLowerCase();
        
        // Check for creator-related questions
        if (message.includes('creator') || 
            message.includes('who made you') || 
            message.includes('who created you') ||
            message.includes('who built you') ||
            message.includes('who is your creator') ||
            (message.includes('who') && message.includes('made') && message.includes('you')) ||
            (message.includes('who') && message.includes('created') && message.includes('you'))) {
            
            const creatorResponses = [
                `My creator is GarryDaCarry! They're the amazing developer who brought me to life 🤖💙`,
                `GarryDaCarry is my creator! I owe my existence to their incredible coding skills ✨`,
                `I was created by GarryDaCarry! They're the genius behind all my personality and features 😊`,
                `My maker is GarryDaCarry! Without them, I wouldn't be here chatting with you all today 💫`,
                `GarryDaCarry built me! They're the mastermind who gave me life and purpose in this community 🎯`
            ];
            
            return creatorResponses[Math.floor(Math.random() * creatorResponses.length)];
        }
        
        // Check for server owner questions
        if (message.includes('server owner') || 
            message.includes('who owns this server') ||
            message.includes('who runs this server') ||
            message.includes('owner of this server') ||
            (message.includes('who') && message.includes('owns') && message.includes('server')) ||
            (message.includes('who') && message.includes('runs') && message.includes('server'))) {
            
            const ownerResponses = [
                `The server owner is Knuck0ball! They're the one who runs this amazing community 👑`,
                `Knuck0ball owns this server! They're the boss who keeps everything running smoothly ⚡`,
                `This server is owned by Knuck0ball! They built this incredible community we all love 🏰`,
                `Knuck0ball is the server owner! They're the mastermind behind this awesome place 🌟`,
                `The owner of this server is Knuck0ball! They created this fantastic community for everyone 💎`
            ];
            
            return ownerResponses[Math.floor(Math.random() * ownerResponses.length)];
        }
        
        return null; // No creator/owner question detected
    }

    async tryMistral(history, userMessage, displayName, isShortResponse = false) {
        try {
            const apiKey = process.env.MISTRAL_API_KEY;
            if (!apiKey || apiKey === 'DEMO_KEY' || apiKey.length < 10) {
                Logger.warning('Mistral API key not configured');
                return null;
            }

            // Build conversation history for Mistral (OpenAI-compatible format) with rulebook context
            const messages = [
                { role: 'system', content: this.getSystemPromptWithRulebook() }
            ];

            // Add conversation history
            const recentHistory = history.slice(-6); // Only sends recent context
            for (const entry of recentHistory) {
                // Include image context if it was part of the conversation
                let userContent = `${entry.displayName}: ${entry.userMessage}`;
                if (entry.imageContext) {
                    userContent += ` [Earlier they shared an image showing: ${entry.imageContext}]`;
                }
                messages.push({ role: 'user', content: userContent });
                messages.push({ role: 'assistant', content: entry.botResponse });
            }

            // Add current message
            messages.push({ role: 'user', content: `${displayName}: ${userMessage}` });

            const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'ministral-8b-2410',
                    messages: messages,
                    max_tokens: isShortResponse ? 100 : 200,
                    temperature: 0.85,
                    top_p: 0.95,
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.choices && data.choices[0] && data.choices[0].message) {
                    Logger.info('AI response generated via Mistral (fallback)');
                    return this.cleanResponse(data.choices[0].message.content);
                }
            } else {
                const errorText = await response.text();
                Logger.warning(`Mistral API error (${response.status}):`, errorText);
            }
        } catch (error) {
            Logger.warning('Mistral API failed:', error.message);
        }
        return null;
    }

    async tryGroq(history, userMessage, displayName, isShortResponse = false) {
        try {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey || apiKey === 'DEMO_KEY' || apiKey.length < 10) {
                Logger.warning('Groq API key not configured properly');
                return null;
            }

            // Build conversation history for Groq with rulebook context
            const messages = [
                { role: 'system', content: this.getSystemPromptWithRulebook() }
            ];

            // Add conversation history
            const recentHistory = history.slice(-6); // Only sends recent context
            for (const entry of recentHistory) {
                // Include image context if it was part of the conversation
                let userContent = `${entry.displayName}: ${entry.userMessage}`;
                if (entry.imageContext) {
                    userContent += ` [Earlier they shared an image showing: ${entry.imageContext}]`;
                }
                messages.push({ role: 'user', content: userContent });
                messages.push({ role: 'assistant', content: entry.botResponse });
            }

            // Add current message
            messages.push({ role: 'user', content: `${displayName}: ${userMessage}` });

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    messages: messages,
                    max_tokens: isShortResponse ? 100 : 250,
                    temperature: 0.9,
                    top_p: 0.95,
                    frequency_penalty: 0.1,
                    presence_penalty: 0.1,
                    stop: ['User:', 'Human:', '\n\nUser:', '\n\nHuman:']
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.choices && data.choices[0] && data.choices[0].message) {
                    Logger.info('AI response generated via Groq (primary - Llama 4 Maverick with Rulebook)');
                    return this.cleanResponse(data.choices[0].message.content);
                }
            } else {
                const errorText = await response.text();
                Logger.warning(`Groq API error (${response.status}):`, errorText);
                if (response.status === 401) {
                    Logger.error('Groq API key is invalid!');
                }
            }
        } catch (error) {
            Logger.warning('Groq API failed:', error.message);
        }
        return null;
    }



    cleanResponse(response) {
        // Clean up the AI response while preserving personality
        let cleaned = response
            .replace(/^(Bot:|Assistant:|AI:|Beluga Bot:|BelugaBot:)/i, '') // Remove AI prefixes
            .replace(/^\s*['"]\s*/, '') // Remove starting quotes
            .replace(/\s*['"]\s*$/, '') // Remove ending quotes
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        // If response is too short or generic, don't use it
        if (cleaned.length < 5 || 
            cleaned.toLowerCase().includes('i am an ai') ||
            cleaned.toLowerCase().includes('as an ai') ||
            cleaned.toLowerCase().includes('i cannot') ||
            cleaned.toLowerCase().includes('i don\'t have access')) {
            return null;
        }

        return cleaned;
    }



    getConversationHistory(userId) {
        return this.conversationHistory.get(userId) || [];
    }

    updateConversationHistory(userId, userMessage, botResponse, displayName = 'User', imageContext = null) {
        if (!this.conversationHistory.has(userId)) {
            this.conversationHistory.set(userId, []);
        }
        
        const history = this.conversationHistory.get(userId);
        history.push({
            userMessage,
            botResponse,
            displayName,
            imageContext, // Store what was seen in the image
            timestamp: Date.now()
        });
        
        // Keep only recent messages to prevent memory issues
        if (history.length > this.maxHistoryLength) {
            history.shift();
        }
    }

    isRateLimited(userId) {
        const lastRequest = this.apiCooldowns.get(userId);
        const now = Date.now();
        const cooldownTime = 3000; // 3 seconds between requests
        
        return lastRequest && (now - lastRequest) < cooldownTime;
    }

    setRateLimit(userId) {
        this.apiCooldowns.set(userId, Date.now());
    }

    isTimeLimited(userId) {
        const timeLimitTimestamp = this.timeLimitedUsers.get(userId);
        const now = Date.now();
        const timeLimitDuration = 60000; // 60 seconds (1 minute)
        
        if (timeLimitTimestamp && (now - timeLimitTimestamp) < timeLimitDuration) {
            return true;
        }
        
        // Clean up expired time limits
        if (timeLimitTimestamp && (now - timeLimitTimestamp) >= timeLimitDuration) {
            this.timeLimitedUsers.delete(userId);
        }
        
        return false;
    }

    setTimeLimit(userId) {
        this.timeLimitedUsers.set(userId, Date.now());
        Logger.info(`User ${userId} has been time-limited for 60 seconds`);
    }

    // Clean up old data periodically
    cleanup() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        // Clean conversation history
        for (const [userId, history] of this.conversationHistory.entries()) {
            const filteredHistory = history.filter(entry => 
                (now - entry.timestamp) < maxAge
            );
            
            if (filteredHistory.length === 0) {
                this.conversationHistory.delete(userId);
            } else {
                this.conversationHistory.set(userId, filteredHistory);
            }
        }
        
        // Clean rate limit cache
        for (const [userId, timestamp] of this.apiCooldowns.entries()) {
            if ((now - timestamp) > 60000) { // 1 minute
                this.apiCooldowns.delete(userId);
            }
        }
        
        // Clean time-limited users cache
        for (const [userId, timestamp] of this.timeLimitedUsers.entries()) {
            if ((now - timestamp) > 60000) { // 1 minute
                this.timeLimitedUsers.delete(userId);
                Logger.info(`Time limit expired for user ${userId}`);
            }
        }
    }

    shouldRespond(message, botUser) {
        // STRICT: Only respond to direct mentions
        // No general conversation responses to prevent unwanted triggers
        if (message.mentions.has(botUser)) return true;
        
        // Never respond to anything else - mention-only bot
        return false;
    }

    async analyzeImageWithGroq(imageUrl, userMessage, displayName) {
        // Use Groq's Llama 4 Maverick vision model to analyze images
        // Returns both the response AND a summary of what was seen for context storage
        try {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey || apiKey === 'DEMO_KEY' || apiKey.length < 10) {
                Logger.warning('Groq API key not configured - skipping image analysis');
                return null;
            }

            Logger.info(`Analyzing image with Groq vision: ${imageUrl}`);
            
            // Build message with image for vision model
            const messages = [
                {
                    role: 'system',
                    content: this.systemPrompt + '\n\nWhen describing images, be concise but capture the key visual elements for context.'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `${displayName}: ${userMessage || 'What do you see in this image?'}`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl
                            }
                        }
                    ]
                }
            ];

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
                    messages: messages,
                    max_tokens: 300,
                    temperature: 0.9,
                    top_p: 0.95
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.choices && data.choices[0] && data.choices[0].message) {
                    Logger.success('Image analyzed successfully with Groq vision');
                    const fullResponse = this.cleanResponse(data.choices[0].message.content);
                    
                    // Create a concise summary for context (first 200 chars of response)
                    const contextSummary = fullResponse.substring(0, 200).replace(/[\n\r]+/g, ' ');
                    
                    return {
                        response: fullResponse,
                        context: contextSummary // What the image showed, for memory
                    };
                }
            } else {
                const errorText = await response.text();
                Logger.warning(`Groq vision API error (${response.status}):`, errorText);
            }

            return null;

        } catch (error) {
            Logger.error('Groq vision analysis failed:', error.message);
            return null;
        }
    }

    extractImageUrls(messageContent, attachments) {
        // Extract image URLs from message content and attachments
        const urls = [];

        // Check attachments first (most common)
        if (attachments && attachments.size > 0) {
            attachments.forEach(attachment => {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    urls.push(attachment.url);
                }
            });
        }

        // Check for Discord CDN URLs in message content
        const cdnRegex = /https?:\/\/cdn\.discordapp\.com\/[^\s<>]+\.(png|jpg|jpeg|gif|webp)(\?[^\s<>]*)?/gi;
        const matches = messageContent.match(cdnRegex);
        if (matches) {
            // Clean up any trailing characters
            matches.forEach(url => {
                const cleanUrl = url.split(')')[0].split('>')[0];
                if (!urls.includes(cleanUrl)) {
                    urls.push(cleanUrl);
                }
            });
        }

        return urls;
    }
}

module.exports = AIChatHandler;