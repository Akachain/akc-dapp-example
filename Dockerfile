FROM node:12-alpine

ARG PORT=3000

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY . .
RUN npm install && npm cache clean --force

EXPOSE $PORT

CMD [ "npm", "run", "start" ]
