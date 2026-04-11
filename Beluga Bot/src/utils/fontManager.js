const { registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');

class FontManager {
  constructor() {
    this.registeredFonts = new Set();
  }

  /**
   * Register a custom font file
   * @param {string} fontPath - Path to the font file
   * @param {string} fontFamily - Font family name to use in CSS
   */
  registerCustomFont(fontPath, fontFamily) {
    try {
      if (!fs.existsSync(fontPath)) {
        Logger.warning(`Font file not found: ${fontPath}`);
        return false;
      }

      registerFont(fontPath, { family: fontFamily });
      this.registeredFonts.add(fontFamily);
      Logger.success(`Registered custom font: ${fontFamily}`);
      return true;
    } catch (error) {
      Logger.error(`Failed to register font ${fontFamily}`, error);
      return false;
    }
  }

  /**
   * Initialize all custom fonts
   */
  initializeFonts() {
    const fontsDir = path.join(__dirname, '../../fonts');
    
    // Try to register Anton font if available
    const antonPath = path.join(fontsDir, 'Anton-Regular.ttf');
    this.registerCustomFont(antonPath, 'Anton');

    // You can add more custom fonts here
    // const otherFontPath = path.join(fontsDir, 'OtherFont.ttf');
    // this.registerCustomFont(otherFontPath, 'OtherFont');
  }

  /**
   * Check if a font family is registered
   */
  isFontRegistered(fontFamily) {
    return this.registeredFonts.has(fontFamily);
  }

  /**
   * Get available fonts
   */
  getRegisteredFonts() {
    return Array.from(this.registeredFonts);
  }
}

// Create singleton instance
const fontManager = new FontManager();

// Initialize fonts when this module is loaded
fontManager.initializeFonts();

module.exports = fontManager;
