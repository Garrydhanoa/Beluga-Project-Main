const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

class RuleBookManager {
    constructor() {
        this.documentId = '1jKUtjoQIPY-MGhhq1EpctPqEzu_jrt9kmko8mbq6HiE';
        this.rules = new Map(); // Store parsed rules by section
        this.keywordIndex = new Map(); // Separate index for keyword search
        this.lastUpdate = null;
        this.updateInterval = 60 * 60 * 1000; // 1 hour in milliseconds
        this.credentials = null;
        this.isUpdating = false;
        
        // Initialize on construction
        this.initialize();
    }

    async initialize() {
        try {
            Logger.info('Initializing RuleBook Manager...');
            await this.loadCredentials();
            await this.updateRules(); // Initial load
            this.startAutoUpdate(); // Start hourly updates
            Logger.success('RuleBook Manager initialized successfully');
        } catch (error) {
            Logger.error('Failed to initialize RuleBook Manager:', error);
        }
    }

    async loadCredentials() {
        try {
            // Use the same pattern as the existing standings feature
            // Check for environment variable first (Railway deployment)
            const credentialsJson = process.env.GOOGLE_CREDENTIALS;
            if (credentialsJson) {
                try {
                    this.credentials = JSON.parse(credentialsJson);
                    Logger.info('Google credentials loaded from environment variable');
                    return;
                } catch (error) {
                    Logger.error('Failed to parse GOOGLE_CREDENTIALS JSON:', error);
                }
            }

            // Fallback to local file (development)
            const credentialsPath = path.join(__dirname, '../../credentials.json');
            const credentialsData = await fs.readFile(credentialsPath, 'utf8');
            this.credentials = JSON.parse(credentialsData);
            Logger.info('Google credentials loaded from local file');
            
        } catch (error) {
            Logger.error('Failed to load Google credentials:', error);
            throw error;
        }
    }

    async updateRules() {
        if (this.isUpdating) {
            Logger.info('Rule update already in progress, skipping...');
            return;
        }

        try {
            this.isUpdating = true;
            Logger.info('Updating rulebook from Google Docs...');

            // Initialize Google Docs API
            const auth = new google.auth.GoogleAuth({
                credentials: this.credentials,
                scopes: ['https://www.googleapis.com/auth/documents.readonly']
            });

            const docs = google.docs({ version: 'v1', auth });

            // Fetch document content
            const response = await docs.documents.get({
                documentId: this.documentId
            });

            const content = response.data;
            await this.parseRules(content);
            
            this.lastUpdate = new Date();
            Logger.success(`Rulebook updated successfully. Rules count: ${this.rules.size}`);

        } catch (error) {
            Logger.error('Failed to update rulebook:', error);
            // Don't throw - let bot continue with cached rules if available
        } finally {
            this.isUpdating = false;
        }
    }

    async parseRules(document) {
        try {
            Logger.info('Parsing rulebook content...');
            this.rules.clear();
            this.keywordIndex.clear();

            const content = document.body.content;
            let currentSection = null;
            let currentNumber = null;
            let currentContent = '';

            for (const element of content) {
                if (element.paragraph) {
                    const paragraph = element.paragraph;
                    let text = '';

                    // Extract text from paragraph elements
                    if (paragraph.elements) {
                        for (const elem of paragraph.elements) {
                            if (elem.textRun && elem.textRun.content) {
                                text += elem.textRun.content;
                            }
                        }
                    }

                    text = text.trim();
                    if (!text) continue;

                    // Check if this is a section header (e.g., "Section 1:", "1.", "1.1", etc.)
                    const sectionMatch = text.match(/^(?:Section\s+)?(\d+(?:\.\d+)*)[:\.]?\s*(.*)/i);
                    
                    if (sectionMatch) {
                        // Save previous section if exists
                        if (currentSection && currentContent) {
                            this.saveRule(currentSection, currentNumber, currentContent);
                        }

                        // Start new section
                        currentNumber = sectionMatch[1];
                        currentSection = sectionMatch[2] || `Section ${currentNumber}`;
                        currentContent = text + '\n';
                        
                        Logger.debug(`Found section: ${currentNumber} - ${currentSection}`);
                    } else if (currentSection) {
                        // Add content to current section
                        currentContent += text + '\n';
                    }
                }
            }

            // Save final section
            if (currentSection && currentContent) {
                this.saveRule(currentSection, currentNumber, currentContent);
            }

            Logger.success(`Parsed ${this.rules.size} rule sections`);

        } catch (error) {
            Logger.error('Error parsing rules:', error);
            throw error;
        }
    }

    saveRule(section, number, content) {
        const ruleData = {
            section: section,
            number: number,
            content: content.trim(),
            keywords: this.extractKeywords(content),
            timestamp: new Date()
        };

        // Store by section number and name for easy lookup
        this.rules.set(number, ruleData);
        this.rules.set(section.toLowerCase(), ruleData);
        
        // Store keywords in separate index
        ruleData.keywords.forEach(keyword => {
            if (!this.keywordIndex.has(keyword)) {
                this.keywordIndex.set(keyword, []);
            }
            this.keywordIndex.get(keyword).push(ruleData);
        });
    }

    extractKeywords(content) {
        // Extract meaningful keywords from rule content
        const text = content.toLowerCase();
        const keywords = [];
        
        // Common league terms
        const leagueTerms = [
            'roster', 'substitute', 'sub', 'player', 'team', 'match', 'game',
            'forfeit', 'reschedule', 'penalty', 'warning', 'ban', 'suspension',
            'playoff', 'tournament', 'season', 'division', 'rank', 'score',
            'overtime', 'replay', 'dispute', 'protest', 'appeal', 'admin',
            'captain', 'manager', 'coach', 'eligibility', 'transfer',
            'schedule', 'deadline', 'registration', 'bracket', 'seeding'
        ];

        leagueTerms.forEach(term => {
            if (text.includes(term)) {
                keywords.push(term);
            }
        });

        return keywords;
    }

    searchRules(query) {
        const searchTerms = query.toLowerCase().split(' ');
        const results = new Map();
        
        // Search by section number first (highest priority)
        const numberMatch = query.match(/\b(\d+(?:\.\d+)*)\b/);
        if (numberMatch) {
            const rule = this.rules.get(numberMatch[1]);
            if (rule && typeof rule === 'object') {
                results.set(rule.number, { ...rule, relevance: 100 });
            }
        }

        // Search by keywords and content
        this.rules.forEach((rule, key) => {
            if (typeof rule !== 'object' || !rule || !rule.content || !rule.section) return;

            let relevance = 0;
            const ruleText = rule.content.toLowerCase();
            const ruleSection = rule.section.toLowerCase();

            // Check section name match
            searchTerms.forEach(term => {
                if (ruleSection.includes(term)) relevance += 20;
                if (ruleText.includes(term)) relevance += 10;
                if (rule.keywords && rule.keywords.includes(term)) relevance += 15;
            });

            if (relevance > 0) {
                const existing = results.get(rule.number);
                if (!existing || existing.relevance < relevance) {
                    results.set(rule.number, { ...rule, relevance });
                }
            }
        });

        // Sort by relevance and return top 3
        return Array.from(results.values())
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 3);
    }

    getRuleByNumber(number) {
        const rule = this.rules.get(number.toString());
        return (rule && typeof rule === 'object') ? rule : null;
    }

    getAllRules() {
        const allRules = [];
        this.rules.forEach((rule, key) => {
            if (typeof rule === 'object' && !allRules.find(r => r.number === rule.number)) {
                allRules.push(rule);
            }
        });
        return allRules.sort((a, b) => {
            const aNum = parseFloat(a.number || '0');
            const bNum = parseFloat(b.number || '0');
            return aNum - bNum;
        });
    }

    startAutoUpdate() {
        setInterval(() => {
            Logger.info('Scheduled rulebook update starting...');
            this.updateRules();
        }, this.updateInterval);
        
        Logger.info(`Rulebook auto-update scheduled every ${this.updateInterval / 1000 / 60} minutes`);
    }

    getStatus() {
        return {
            rulesCount: this.rules.size,
            lastUpdate: this.lastUpdate,
            isUpdating: this.isUpdating,
            documentId: this.documentId
        };
    }

    // Method to force update (for admin commands)
    async forceUpdate() {
        Logger.info('Force updating rulebook...');
        await this.updateRules();
        return this.getStatus();
    }
}

module.exports = RuleBookManager;