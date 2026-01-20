# ----------------------------------------
# STAGE 1: Build the Frontend (Vite)
# ----------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./
RUN npm install

# Copy source code and build the React app
COPY . .
# This creates the /dist folder
RUN npm run build 

# ----------------------------------------
# STAGE 2: Setup the Backend (Node)
# ----------------------------------------
FROM node:20-alpine
WORKDIR /app

# Install dependencies (Production only to save space)
COPY package*.json ./
RUN npm install

# Copy backend source files
COPY server.ts ./
COPY tsconfig.json ./
# (Optional) If you have other folders like /services or /types, copy them too:
COPY services ./services
COPY components ./components
COPY types.ts ./

# Copy the built frontend from Stage 1
COPY --from=frontend-builder /app/dist ./dist

# Create cache directories manually to ensure permissions
RUN mkdir -p img_cache/logos

# Expose the API/App port
EXPOSE 3001

# Start the Hybrid Engine
# Using ts-node for simplicity (ensure ts-node is in package.json)
CMD ["npx", "tsx", "server.ts"]