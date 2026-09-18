FROM apify/actor-node-puppeteer-chrome:22
COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --omit=optional && rm -rf ~/.npm
COPY --chown=myuser . ./
CMD npm start --silent
