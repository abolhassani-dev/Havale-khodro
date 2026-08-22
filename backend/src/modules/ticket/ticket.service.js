const { ticketRepository } = require('./ticket.repository');
const { toStoredFile } = require('../../utils/uploads');
const authRepository = require('../auth/auth.repository');
const { MESSAGES } = require('../../constants/messages');
const { isAdmin } = require('../../constants/roles');
const { NotFoundError, BadRequestError } = require('../../errors/AppError');

/**
 * Support tickets.
 *
 * Deliberately open to expired subscriptions. The access table allows it because
 * the most common reason to write is to arrange a renewal, and an agency locked
 * out of the only channel for asking how to pay is an agency that stops paying.
 * The same channel carries appeals against a violation strike (blueprint 8.5).
 */
/** What multer hands over, in the shape the repository stores. */
function toStoredFiles(files) {
  return (files || []).map(toStoredFile);
}

const ticketService = {
  async create({ user, subject, category, priority, body, files }) {
    const ticket = await ticketRepository.create({
      userId: user.id,
      subject,
      category,
      priority,
      body,
    });

    const stored = toStoredFiles(files);
    if (stored.length) await ticketRepository.attachFiles(ticket.messages[0].id, stored);

    await authRepository.recordActivity({
      userId: user.id,
      action: 'TICKET_OPENED',
      targetType: 'TICKET',
      targetId: ticket.id,
      summary: subject,
    });

    return toTicket(await ticketRepository.findById(ticket.id));
  },

  async list({ user, status, category }) {
    // Staff see the whole queue; an agent sees only their own. The scope is part
    // of the query rather than a check afterwards, so a missing check cannot
    // show one agency another's correspondence.
    const tickets = await ticketRepository.list({
      userId: isAdmin(user.role) ? undefined : user.id,
      status,
      category,
    });
    return tickets.map(toTicketSummary);
  },

  async get({ user, id }) {
    const ticket = await this.requireVisible(user, id);
    return toTicket(ticket);
  },

  async reply({ user, id, body, files }) {
    const ticket = await this.requireVisible(user, id);

    // A closed ticket needs reopening first. Otherwise a conversation continues
    // under a status that says nobody is looking at it.
    if (ticket.status === 'CLOSED') throw new BadRequestError(MESSAGES.TICKET.CLOSED);

    const [message] = await ticketRepository.addMessage({
      ticketId: id,
      authorId: user.id,
      body,
      isStaff: isAdmin(user.role),
    });

    const stored = toStoredFiles(files);
    if (stored.length) await ticketRepository.attachFiles(message.id, stored);

    return toTicket(await ticketRepository.findById(id));
  },

  /**
   * An attachment, after proving the asker may see its conversation — the
   * file route must answer with exactly the visibility rules of the ticket.
   */
  async attachment({ user, id }) {
    const att = await ticketRepository.findAttachment(id);
    if (!att) throw new NotFoundError('پیوست');
    await this.requireVisible(user, att.message.ticketId);
    return att;
  },

  /** Either side may close a ticket; only staff may reopen one. */
  async setStatus({ user, id, status }) {
    const ticket = await this.requireVisible(user, id);

    if (!isAdmin(user.role) && status !== 'CLOSED') {
      throw new BadRequestError(MESSAGES.TICKET.AGENT_MAY_ONLY_CLOSE);
    }

    await ticketRepository.setStatus(ticket.id, status);
    return toTicket(await ticketRepository.findById(id));
  },

  async setPriority({ id, priority }) {
    await ticketRepository.setPriority(id, priority);
    return toTicket(await ticketRepository.findById(id));
  },

  async requireVisible(user, id) {
    const ticket = await ticketRepository.findById(id);
    if (!ticket) throw new NotFoundError('تیکت');
    // Not-found rather than forbidden: confirming a ticket exists but belongs to
    // someone else is information the caller did not have.
    if (!isAdmin(user.role) && ticket.userId !== user.id) throw new NotFoundError('تیکت');
    return ticket;
  },
};

function toTicketSummary(ticket) {
  return {
    id: ticket.id,
    serial: ticket.serial,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    lastReplyAt: ticket.lastReplyAt,
    createdAt: ticket.createdAt,
    agency: ticket.user
      ? { id: ticket.user.id, name: ticket.user.agencyName, code: ticket.user.agencyCode }
      : null,
  };
}

function toTicket(ticket) {
  return {
    ...toTicketSummary(ticket),
    messages: (ticket.messages || []).map((m) => ({
      id: m.id,
      body: m.body,
      isStaff: m.isStaff,
      createdAt: m.createdAt,
      // Staff replies are signed "پشتیبانی" rather than by name. Which employee
      // answered is not something an agency needs, and naming them invites
      // people to go around the system and contact them directly.
      author: m.isStaff ? 'پشتیبانی' : m.author?.fullName || null,
      attachments: (m.attachments || []).map((a) => ({
        id: a.id,
        name: a.name,
        mime: a.mime,
        size: a.size,
        url: `/api/v1/tickets/attachments/${a.id}`,
      })),
    })),
  };
}

module.exports = ticketService;
