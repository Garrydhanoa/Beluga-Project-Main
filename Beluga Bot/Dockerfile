# Use Node.js 18 LTS
FROM node:18-slim

# Install system dependencies for Canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create non-root user
RUN useradd -m -u 1001 botuser && chown -R botuser:botuser /app
USER botuser

# Expose health check port
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
