FROM node:alpine

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json package-lock.json /usr/src/app/
RUN npm install
COPY . /usr/src/app

ENV NODE_ENV production

CMD [ "npm", "run", "start" ]
