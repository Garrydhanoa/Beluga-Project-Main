const { config } = require('../config/config');
const { googleSheetsService } = require('./googleSheets');
const { imageGenerator } = require('./imageGenerator');
const Logger = require('./logger');

class DevUtils {
    static async runDiagnostics() {
        Logger.info('🔧 Running full system diagnostics...');
        
        const results = {
            config: await this.testConfig(),
            googleSheets: await this.testGoogleSheets(),
            imageGeneration: await this.testImageGeneration(),
            divisions: await this.testAllDivisions(),
        };

        this.printDiagnosticsReport(results);
        return results;
    }

    static async testConfig() {
        try {
            const requiredEnvVars = [
                'DISCORD_TOKEN',
                'APPLICATION_ID',
                'SHEET_ID_AA',
                'SHEET_ID_AAA',
                'SHEET_ID_MAJORS'
            ];

            const missing = requiredEnvVars.filter(varName => !process.env[varName]);
            
            return {
                status: missing.length === 0 ? 'PASS' : 'FAIL',
                details: missing.length === 0 
                    ? 'All required environment variables present'
                    : `Missing: ${missing.join(', ')}`,
                missingVars: missing
            };
        } catch (error) {
            return {
                status: 'ERROR',
                details: error.message,
                error
            };
        }
    }

    static async testGoogleSheets() {
        try {
            const testResult = await googleSheetsService.testConnection();
            return {
                status: testResult ? 'PASS' : 'FAIL',
                details: testResult 
                    ? 'Google Sheets API connection successful'
                    : 'Failed to connect to Google Sheets API'
            };
        } catch (error) {
            return {
                status: 'ERROR',
                details: error.message,
                error
            };
        }
    }

    static async testImageGeneration() {
        try {
            const testImage = await imageGenerator.testImageGeneration();
            return {
                status: testImage ? 'PASS' : 'FAIL',
                details: testImage 
                    ? 'Image generation working correctly'
                    : 'Image generation failed'
            };
        } catch (error) {
            return {
                status: 'ERROR',
                details: error.message,
                error
            };
        }
    }

    static async testAllDivisions() {
        const results = {};
        
        for (const division of config.divisions) {
            try {
                const data = await googleSheetsService.fetchStandingsData(division.value);
                results[division.value] = {
                    status: data && data.length > 0 ? 'PASS' : 'FAIL',
                    details: `Found ${data ? data.length : 0} teams`,
                    teamCount: data ? data.length : 0
                };
            } catch (error) {
                results[division.value] = {
                    status: 'ERROR',
                    details: error.message,
                    error
                };
            }
        }
        
        return results;
    }

    static printDiagnosticsReport(results) {
        Logger.info('\n📋 DIAGNOSTICS REPORT');
        Logger.info('=' .repeat(50));
        
        // Configuration
        Logger.info(`\n🔧 Configuration: ${this.getStatusEmoji(results.config.status)}`);
        Logger.info(`   ${results.config.details}`);
        
        // Google Sheets
        Logger.info(`\n📊 Google Sheets: ${this.getStatusEmoji(results.googleSheets.status)}`);
        Logger.info(`   ${results.googleSheets.details}`);
        
        // Image Generation
        Logger.info(`\n🖼️  Image Generation: ${this.getStatusEmoji(results.imageGeneration.status)}`);
        Logger.info(`   ${results.imageGeneration.details}`);
        
        // Divisions
        Logger.info('\n🏆 Divisions:');
        for (const [divisionKey, result] of Object.entries(results.divisions)) {
            const division = config.divisions.find(d => d.value === divisionKey);
            Logger.info(`   ${division?.displayName || divisionKey}: ${this.getStatusEmoji(result.status)} (${result.details})`);
        }
        
        Logger.info('\n' + '=' .repeat(50));
        
        const allPassed = [
            results.config.status,
            results.googleSheets.status,
            results.imageGeneration.status,
            ...Object.values(results.divisions).map(r => r.status)
        ].every(status => status === 'PASS');
        
        if (allPassed) {
            Logger.success('🎉 All systems operational!');
        } else {
            Logger.warning('⚠️  Some systems need attention. Check the details above.');
        }
    }

    static getStatusEmoji(status) {
        switch (status) {
            case 'PASS': return '✅';
            case 'FAIL': return '❌';
            case 'ERROR': return '💥';
            default: return '❓';
        }
    }

    static async generateTestStandings(division = 'aa') {
        try {
            Logger.info(`🧪 Generating test standings for ${division}...`);
            
            const data = await googleSheetsService.fetchStandingsData(division);
            const image = await imageGenerator.createStandingsImage(data, division);
            
            const fs = require('fs');
            const path = require('path');
            const testImagePath = path.join(__dirname, '../../test-standings.png');
            
            fs.writeFileSync(testImagePath, image);
            Logger.success(`Test image saved to: ${testImagePath}`);
            
            return testImagePath;
        } catch (error) {
            Logger.error('Failed to generate test standings', error);
            throw error;
        }
    }
}

module.exports = DevUtils;
