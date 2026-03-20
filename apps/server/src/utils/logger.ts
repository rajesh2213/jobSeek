import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
};
if (isDev) {
  loggerOptions.transport = { target: "pino-pretty", options: { colorize: true } };
}

export const logger = pino(loggerOptions);
