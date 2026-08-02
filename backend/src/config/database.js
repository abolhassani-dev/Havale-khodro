const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// A single client for the process. Creating one per request exhausts the
// database's connection limit under load — the most common way an app like this
// falls over in production.
const prisma = new PrismaClient();

async function connectDatabase() {
  await prisma.$connect();
  logger.info('Database connected');
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

module.exports = { connectDatabase, disconnectDatabase, prisma };
