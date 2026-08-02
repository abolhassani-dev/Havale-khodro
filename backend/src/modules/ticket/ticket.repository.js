const { prisma } = require('../../config/database');

const AUTHOR_SELECT = {
  select: { id: true, fullName: true, agencyName: true, agencyCode: true, role: true },
};

const ticketRepository = {
  /**
   * Opening a ticket and writing its first message are one operation — a ticket
   * with no message is not a question anyone can answer.
   */
  create({ userId, subject, priority, body }) {
    return prisma.ticket.create({
      data: {
        userId,
        subject,
        priority,
        messages: { create: { authorId: userId, body, isStaff: false } },
      },
      include: { messages: { include: { author: AUTHOR_SELECT } } },
    });
  },

  findById(id) {
    return prisma.ticket.findUnique({
      where: { id },
      include: {
        user: AUTHOR_SELECT,
        messages: { orderBy: { createdAt: 'asc' }, include: { author: AUTHOR_SELECT } },
      },
    });
  },

  list({ userId, status, take = 50 }) {
    return prisma.ticket.findMany({
      where: { ...(userId ? { userId } : {}), ...(status ? { status } : {}) },
      orderBy: { lastReplyAt: 'desc' },
      take,
      include: { user: AUTHOR_SELECT },
    });
  },

  /**
   * A reply also moves the ticket's state, and the two must not drift: a staff
   * answer marks it ANSWERED, an agent reply reopens it. Doing both in one
   * transaction is what keeps the queue honest.
   */
  addMessage({ ticketId, authorId, body, isStaff }) {
    return prisma.$transaction([
      prisma.ticketMessage.create({ data: { ticketId, authorId, body, isStaff } }),
      prisma.ticket.update({
        where: { id: ticketId },
        data: { status: isStaff ? 'ANSWERED' : 'OPEN', lastReplyAt: new Date() },
      }),
    ]);
  },

  setStatus(id, status) {
    return prisma.ticket.update({ where: { id }, data: { status } });
  },

  setPriority(id, priority) {
    return prisma.ticket.update({ where: { id }, data: { priority } });
  },
};

module.exports = { ticketRepository, AUTHOR_SELECT };
