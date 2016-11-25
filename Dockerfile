FROM node:6

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json /usr/src/app/
RUN npm install
COPY . /usr/src/app
RUN npm run dist

RUN mkdir -p /var/configstore
ENV NODE_ENV production

CMD [ "npm", "run", "start:dist" ]
