import { buildServer } from "./server/fastify.js";
import { logger } from "./utils/logger.js";

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: PORT, host: "0.0.0.0" });
    server.log.info({ port: PORT }, "Server listening");
  } catch (err) {
    logger.error(err, "Server failed to start");
    process.exit(1);
  }
}

main();
