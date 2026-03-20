import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { prisma } from "../../infrastructure/db/prisma.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

const prismaPlugin: FastifyPluginAsync = async (instance: FastifyInstance) => {
  instance.decorate("prisma", prisma);

  instance.addHook("onClose", async (fastify) => {
    await fastify.prisma.$disconnect();
  });
};

export default fp(prismaPlugin, { name: "prisma" });
