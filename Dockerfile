FROM node:20.17-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY ./src .

RUN apk add --no-cache tini curl bash busybox-suid && crontab /etc/crontabs/root

RUN echo "0 * * * * /usr/local/bin/node /usr/src/app/index.js >> /proc/1/fd/1 2>> /proc/1/fd/2" > /etc/crontabs/root

CMD ["crond", "-f"]