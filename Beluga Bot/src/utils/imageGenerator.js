const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const { config } = require('../config/config');
const Logger = require('./logger');
const fontManager = require('./fontManager');

class ImageGenerator {
  constructor() {
    this.imagesDir = path.resolve(__dirname, '../../', config.images.dir);
    this.logosDir = path.resolve(__dirname, '../../', config.images.logosDir);
    
    // Verify paths exist
    if (!fs.existsSync(this.imagesDir)) {
      Logger.warning(`Images directory not found: ${this.imagesDir}`);
    }
    if (!fs.existsSync(this.logosDir)) {
      Logger.warning(`Logos directory not found: ${this.logosDir}`);
    }
  }

  async createStandingsImage(standingsData, division) {
    try {
      Logger.info(`Creating standings image for division: ${division}`);

      if (!standingsData || standingsData.length === 0) {
        throw new Error('No standings data provided');
      }

      // Handle different team counts dynamically
      const teamCount = standingsData.length;
      const divisionConfig = config.divisions.find(d => d.value === division);
      const expectedTeams = divisionConfig?.teamCount || teamCount;
      
      Logger.info(`Processing ${teamCount} teams for ${division} (expected: ${expectedTeams})`);
      
      // Split teams into groups for better layout
      let group1, group2;
      
      if (teamCount <= 8) {
        // Small divisions: single column
        group1 = standingsData;
        group2 = [];
      } else {
        // Larger divisions: split into two columns
        const group1Size = Math.ceil(teamCount / 2);
        group1 = standingsData.slice(0, group1Size);
        group2 = standingsData.slice(group1Size);
      }

      // Load background image
      const backgroundPath = path.resolve(this.imagesDir, `${division.toUpperCase()} BACKGROUND.png`);
      
      if (!fs.existsSync(backgroundPath)) {
        Logger.error(`Background image not found: ${backgroundPath}`);
        throw new Error(`Background image not found for division: ${division}. Expected at: ${backgroundPath}`);
      }

      const background = await loadImage(backgroundPath);
      const canvas = createCanvas(background.width, background.height);
      const ctx = canvas.getContext('2d');

      // Draw background
      ctx.drawImage(background, 0, 0);

      // Configure text styling
      ctx.font = `${config.images.fontWeight || 'bold'} ${config.images.fontSize}px ${config.images.fontFamily}`;
      ctx.fillStyle = config.images.textColor;
      ctx.textAlign = 'left';
      
      // Configure stroke if enabled
      if (config.images.textStroke) {
        ctx.strokeStyle = config.images.strokeColor || '#000000';
        ctx.lineWidth = config.images.strokeWidth || 1.5;
      }

      // Determine per-division overrides (optional)
      const overrides = (config.images.overrides && config.images.overrides[division]) || {};

      // Draw both groups (pass overrides so majors can change startX/startY)
      await this.drawGroup(ctx, group1, 0, overrides);
      if (group2.length > 0) {
        await this.drawGroup(ctx, group2, 1, overrides);
      }

      Logger.success(`Successfully generated standings image for ${division}`);
      return canvas.toBuffer();

    } catch (error) {
      Logger.error(`Failed to create standings image for division: ${division}`, error);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async drawGroup(ctx, group, groupIndex, overrides = {}) {
    // Use overrides if provided for this division (allows majors to adjust startX/startY)
    const startY = overrides.startY || config.images.startY;
    const startX = overrides.startX || config.images.startX;

    let y = startY;
    const baseX = startX + (groupIndex * config.images.groupOffset);

    for (const team of group) {
      // Preserve original name for logo lookup but force display name to ALL CAPS
      const originalName = team.teamName ?? '';
      const displayName = String(originalName).toUpperCase();

      // Try to load and draw team logo (use originalName to match filename)
      await this.drawTeamLogo(ctx, originalName, baseX, y - 6);

      // Draw team name at fixed position (forced to caps) with custom styling
      const teamNameX = baseX + config.images.columns.teamName;
      this.drawStyledText(ctx, displayName, teamNameX, y, config.images.teamName);

      // Draw separator column (single hyphen) at fixed position
      if (config.images.columns.separator) {
        const sepX = baseX + config.images.columns.separator;
        this.drawStyledText(ctx, '-', sepX, y - 1, config.images.separator);
      }

      // Draw wins at fixed position with green color
      const winsX = baseX + config.images.columns.wins;
      this.drawStyledText(ctx, `${team.wins}`, winsX, y, config.images.wins);

      // Draw losses at fixed position with red color
      const lossesX = baseX + config.images.columns.losses;
      this.drawStyledText(ctx, `${team.losses}`, lossesX, y, config.images.losses);

      // Draw game differential at fixed position with conditional color
      const diffText = team.gameDifferential >= 0 ? `+${team.gameDifferential}` : `${team.gameDifferential}`;
      const diffColor = team.gameDifferential >= 0 
        ? config.images.gameDifferential.positiveColor 
        : config.images.gameDifferential.negativeColor;
      
      const diffStyle = {
        ...config.images.gameDifferential,
        color: diffColor
      };
      
      const diffX = baseX + config.images.columns.gameDifferential;
      this.drawStyledText(ctx, diffText, diffX, y, diffStyle);

      y += config.images.teamSpacing;
    }
  }

  drawStyledText(ctx, text, x, y, customStyle = {}) {
    // Merge custom style with defaults
    const style = {
      fontSize: customStyle.fontSize || config.images.fontSize,
      color: customStyle.color || config.images.textColor,
      fontWeight: customStyle.fontWeight || config.images.fontWeight || 'bold',
      fontFamily: customStyle.fontFamily || config.images.fontFamily,
      strokeColor: customStyle.strokeColor || config.images.strokeColor,
      strokeWidth: customStyle.strokeWidth || config.images.strokeWidth,
    };

    // Save current context
    ctx.save();
    
    // Set font properties
    ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    ctx.textAlign = 'left';
    
    // Draw text stroke (outline) first if enabled
    if (config.images.textStroke) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeText(text, x, y);
    }
    
    // Draw filled text on top
    ctx.fillText(text, x, y);
    
    // Measure text width for spacing
    const metrics = ctx.measureText(text);
    
    // Restore context
    ctx.restore();
    
    return metrics.width;
  }

  /**
   * Load a team's logo from the DB (team logo → franchise logo, by name), the same
   * source the website uses. Returns a canvas Image or null. DB is authoritative so
   * admin re-uploads show in bot images too; the file map below is only a fallback.
   */
  async loadDbLogo(teamName) {
    try {
      const { pool, isDatabaseAvailable } = require('./database');
      const up = typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
      if (!up) return null;
      const r = await pool.query(
        `SELECT COALESCE(t.logo_data, f.logo_data) AS data
           FROM teams t LEFT JOIN team_franchises f ON f.id = t.franchise_id
          WHERE LOWER(t.name) = LOWER($1)
          ORDER BY (t.logo_data IS NOT NULL) DESC, t.id DESC LIMIT 1`,
        [teamName]
      );
      let data = r.rows[0]?.data || null;
      if (!data) {
        const fr = await pool.query(
          `SELECT logo_data AS data FROM team_franchises WHERE LOWER(name) = LOWER($1) LIMIT 1`, [teamName]
        );
        data = fr.rows[0]?.data || null;
      }
      if (!data) return null;
      return await loadImage(Buffer.isBuffer(data) ? data : Buffer.from(data));
    } catch (e) {
      Logger.debug(`DB logo lookup failed for ${teamName}: ${e.message}`);
      return null;
    }
  }

  async drawTeamLogo(ctx, teamName, x, y) {
    try {
      // Logos are DB-only (admin-uploaded team logo → franchise logo), matching
      // the website. There is no static /logos file fallback anymore.
      const dbLogo = await this.loadDbLogo(teamName);
      if (dbLogo) {
        const logoHeight = (dbLogo.height * config.images.logoWidth) / dbLogo.width;
        ctx.drawImage(dbLogo, x, y - logoHeight / 2, config.images.logoWidth, logoHeight);
        return;
      }

      // No DB logo: draw a subtle placeholder instead of a hard error block.
      Logger.warning(`No DB logo for team: ${teamName}`);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y - config.images.logoWidth / 2, config.images.logoWidth, config.images.logoWidth);
      ctx.restore();

    } catch (error) {
      Logger.error(`Error loading logo for team ${teamName}:`, error);
      // Draw a placeholder rectangle
      ctx.save();
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(x, y - config.images.logoWidth / 2, config.images.logoWidth, config.images.logoWidth);
      ctx.restore();
    }
  }

  async testImageGeneration() {
    try {
      const testData = [
        { teamName: 'Test Team', wins: 5, losses: 3, gameDifferential: 2 }
      ];
      
      // Test with a simple background (create if needed)
      const canvas = createCanvas(800, 600);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 800, 600);
      
      return canvas.toBuffer();
    } catch (error) {
      Logger.error('Image generation test failed', error);
      return null;
    }
  }
}

// Create singleton instance
const imageGenerator = new ImageGenerator();

async function createStandingsImage(standingsData, division) {
  return imageGenerator.createStandingsImage(standingsData, division);
}

module.exports = {
    createStandingsImage,
    imageGenerator,
};
