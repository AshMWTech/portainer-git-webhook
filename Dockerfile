FROM node:lts-alpine

# Create the directory!
RUN mkdir -p /app/node_modules && chown -R node:node /app
WORKDIR /app

USER node
# Copy the app's files
COPY --chown=node:node . .

# Install dependencies
RUN npm install

# Build the app
RUN npm run build

# Prune the dev dependencies
RUN npm prune --omit=dev

ENV NODE_ENV=production
# Start the app
CMD ["npm", "run", "start"]