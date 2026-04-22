
# Use a slim Node base to keep the Expo container lightweight.
FROM node:20-alpine

#set the working directory
WORKDIR /app

#copy the package.json and package-lock.json files into the container
COPY package*.json .

#install dependencies
RUN npm install

# Copy the rest of the frontend code after installing dependencies.
COPY . .

# Expose the Metro bundler port used by Expo.
EXPOSE 8081

# Start Expo in a Docker-friendly mode.
CMD ["npm", "run", "start", "--", "--clear"]