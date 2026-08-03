/**
 * Canvas font registration.
 *
 * WHY THIS MATTERS: the bot renders every graphic with node-canvas, which draws
 * text using whatever fonts the HOST has. Railway builds this service with
 * nixpacks (railway.toml → builder = "NIXPACKS") on a minimal Node image that
 * installs NO font packages — so the old font stack ("Anton, Impact, Arial
 * Black, …") resolved to none of those faces in production and fell through to
 * a generic default. Local renders on Windows looked fine because Windows ships
 * Impact and Arial Black, which is exactly why the discrepancy went unnoticed.
 *
 * The fix is to ship the fonts ourselves (Beluga Bot/fonts/, OFL-licensed) and
 * register them here, so a render is byte-identical on this machine and on
 * Railway.
 *
 * Anton  — condensed display face, for headlines.
 * Barlow — the workhorse: names, values, labels, notes. Static weights only;
 *          node-canvas/freetype renders a variable font's default instance and
 *          would silently ignore bold.
 *
 * IMPORTANT: registerFont must run BEFORE any canvas measures or draws text, so
 * every card module requires this file at the TOP of its imports. Adding a new
 * card? require('../utils/fontManager') first.
 */

const { registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');

// family name -> the CSS-ish stack to actually pass to ctx.font
const DISPLAY_FAMILY = 'Anton';
const TEXT_FAMILY = 'Barlow';

const FONTS = [
    { file: 'Anton-Regular.ttf', family: DISPLAY_FAMILY, weight: 'normal', style: 'normal' },
    { file: 'Barlow-Regular.ttf', family: TEXT_FAMILY, weight: 'normal', style: 'normal' },
    { file: 'Barlow-Medium.ttf', family: TEXT_FAMILY, weight: '500', style: 'normal' },
    { file: 'Barlow-SemiBold.ttf', family: TEXT_FAMILY, weight: '600', style: 'normal' },
    { file: 'Barlow-Bold.ttf', family: TEXT_FAMILY, weight: 'bold', style: 'normal' },
    { file: 'Barlow-ExtraBold.ttf', family: TEXT_FAMILY, weight: '800', style: 'normal' },
];

class FontManager {
    constructor() {
        this.registeredFonts = new Set();
        this.initialized = false;
    }

    /**
     * Register a custom font file.
     * @param {string} fontPath absolute path to a .ttf/.otf
     * @param {object} opts { family, weight, style } — canvas matches on all three
     */
    registerCustomFont(fontPath, opts) {
        const family = typeof opts === 'string' ? opts : opts.family;
        try {
            if (!fs.existsSync(fontPath)) {
                Logger.warning(`Font file not found: ${fontPath}`);
                return false;
            }
            registerFont(fontPath, typeof opts === 'string' ? { family } : opts);
            this.registeredFonts.add(family);
            return true;
        } catch (error) {
            Logger.error(`Failed to register font ${family}`, error);
            return false;
        }
    }

    /** Register every bundled font. Idempotent — re-registering would be wasteful. */
    initializeFonts() {
        if (this.initialized) return;
        this.initialized = true;

        const fontsDir = path.join(__dirname, '../../fonts');
        let ok = 0;
        for (const f of FONTS) {
            if (this.registerCustomFont(path.join(fontsDir, f.file), {
                family: f.family, weight: f.weight, style: f.style,
            })) ok += 1;
        }

        if (ok === FONTS.length) {
            Logger.success(`Registered ${ok} bundled fonts (${[...this.registeredFonts].join(', ')})`);
        } else if (ok > 0) {
            Logger.warning(`Registered only ${ok}/${FONTS.length} bundled fonts — graphics may fall back to a system face`);
        } else {
            // Not fatal: cards still render, just in whatever the host provides.
            Logger.warning(`No bundled fonts registered from ${fontsDir} — graphics will use a system fallback`);
        }
    }

    isFontRegistered(fontFamily) {
        return this.registeredFonts.has(fontFamily);
    }

    getRegisteredFonts() {
        return Array.from(this.registeredFonts);
    }
}

const fontManager = new FontManager();
fontManager.initializeFonts();

module.exports = fontManager;
module.exports.DISPLAY_FAMILY = DISPLAY_FAMILY;
module.exports.TEXT_FAMILY = TEXT_FAMILY;
