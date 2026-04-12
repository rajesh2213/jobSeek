import type { FastifyInstance } from "fastify";
import { registerApplicationsController } from "./applications.controller.js";

export function registerApplicationsRoutes(server: FastifyInstance): void {
  registerApplicationsController(server);
}
