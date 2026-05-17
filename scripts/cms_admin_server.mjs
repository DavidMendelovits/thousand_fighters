import { createCmsServer } from '../cms/server/createCmsServer.js';

const port = Number(process.env.CMS_ADMIN_PORT ?? 8787);
const host = process.env.CMS_ADMIN_HOST ?? '127.0.0.1';
const server = createCmsServer();

server.listen(port, host, () => {
  console.log(`Thousand Fighters CMS admin: http://${host}:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
