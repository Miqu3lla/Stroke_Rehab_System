
#set node version
FROM node:20-alpine

#set the working directory
WORKDIR /app

#copy the package.json and package-lock.json files into the container
COPY package*.json .

#install dependencies
RUN npm install

#copy the rest of the frontend code
COPY . .

#expose the port your API runs on
EXPOSE 8081

#run the app
CMD ["npm", "run", "start"]