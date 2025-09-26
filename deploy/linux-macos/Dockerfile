# Simple Dockerfile following the README workflow
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache libc6-compat curl

WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Setup will be handled via web interface

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Expose ports
EXPOSE 3000 8080

# Start like the README says: npm run dev
CMD ["npm", "run", "dev"]