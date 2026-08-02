const winston = require('winston');
const config = require('../config');

// Structured JSON in production so a log aggregator can parse it; readable
// lines in development so a human can.
const format = config.isProduction
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level} ${message}${rest}`;
      })
    );

const logger = winston.createLogger({
  level: config.logging.level,
  format,
  transports: [new winston.transports.Console()],
  silent: config.isTest,
});

logger.stream = { write: (message) => logger.info(message.trim()) };

module.exports = logger;
