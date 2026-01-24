# ----------------------------------------
# 1. BUILDER STAGE (Frontend)
# ----------------------------------------
# 🛑 FIX: Capitalized 'AS' to match 'FROM'
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ----------------------------------------
# 2. RUNNER STAGE (Production)
# ----------------------------------------
FROM node:20-alpine
WORKDIR /app

# Install dependencies (only production)
COPY package*.json ./
RUN npm install --only=production

# 🛑 FIX: Explicitly install tsx to prevent "npm warn exec" delays
RUN npm install tsx

# Copy Files
COPY *.ts ./
COPY server.key server.cert ./
COPY services ./services
COPY components ./components
COPY tsconfig.json ./

# Copy the built frontend from the previous stage
COPY --from=frontend-builder /app/dist ./dist

# Create cache directory
RUN mkdir -p img_cache/logos

# Expose API Port
EXPOSE 3001

# Start the server
CMD ["npx", "tsx", "server.ts"]