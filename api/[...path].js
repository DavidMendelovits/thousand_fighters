import { createCmsServer } from '../cms/server/createCmsServer.js';

const server = createCmsServer();

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(request, response) {
  server.emit('request', request, response);
}
