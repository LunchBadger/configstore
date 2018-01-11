FROM node:8

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# The node image comes with debian 8, which has git v2.1. We need
# a newer version to make the receive.denycurrentbranch option work.
RUN sed -i s/jessie/testing/g /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y git

RUN git config --global user.email "support@lunchbadger.com" && \
    git config --global user.name "LunchBadger"

COPY package.json /usr/src/app/
RUN npm install
COPY . /usr/src/app

RUN mkdir -p /var/configstore
ENV NODE_ENV production

CMD [ "npm", "run", "start" ]
