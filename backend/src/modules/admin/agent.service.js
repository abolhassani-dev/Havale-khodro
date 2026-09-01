const bcrypt = require('bcryptjs');

const config = require('../../config');
const agentRepository = require('./agent.repository');
const authRepository = require('../auth/auth.repository');
const subscriptionService = require('../subscription/subscription.service');
const brandAccess = require('../catalog/brandAccess.service');
const { MESSAGES } = require('../../constants/messages');
const { ConflictError, NotFoundError, BadRequestError } = require('../../errors/AppError');

/**
 * Creating and managing agency accounts.
 *
 * There is no public registration anywhere in this system (blueprint 2.1), so
 * this is the only door in: an account exists because somebody here made it in
 * exchange for a subscription.
 */
const agentService = {
  /**
   * Creates the account and returns the password once.
   *
   * The password is chosen here and shown a single time so it can be passed to
   * the agency, and the account must replace it on first sign-in — it is known
   * to somebody other than its owner until they do (blueprint 2.8).
   */
  async create({ actor, payload }) {
    await this.assertUnique(payload);

    const agent = await agentRepository.create({
      username: payload.username,
      passwordHash: await bcrypt.hash(payload.password, config.security.bcryptRounds),
      phone: payload.phone,
      fullName: payload.fullName,
      role: 'AGENT',
      agencyCode: payload.agencyCode,
      agencyName: payload.agencyName,
      city: payload.city,
      coordinatorName: payload.coordinatorName,
      coordinatorPhone: payload.coordinatorPhone,
      isReseller: payload.isReseller || false,
      adminNote: payload.adminNote,
      mustChangePassword: true,
    });

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'AGENT_CREATED',
      targetType: 'USER',
      targetId: agent.id,
      summary: agent.agencyCode,
    });

    return agent;
  },

  async assertUnique({ username, agencyCode, phone }, excludeId = null) {
    const clashes = await Promise.all([
      username ? agentRepository.findByUsername(username) : null,
      agencyCode ? agentRepository.findByAgencyCode(agencyCode) : null,
      phone ? agentRepository.findByPhone(phone) : null,
    ]);

    const [byUsername, byCode, byPhone] = clashes.map((row) =>
      row && row.id !== excludeId ? row : null
    );

    if (byUsername) throw new ConflictError(MESSAGES.ADMIN.USERNAME_TAKEN);
    if (byCode) throw new ConflictError(MESSAGES.ADMIN.CODE_TAKEN);
    if (byPhone) throw new ConflictError(MESSAGES.ADMIN.PHONE_TAKEN);
  },

  async list(filters) {
    const [items, total] = await agentRepository.list(filters);
    return { items, total };
  },

  /**
   * The picker's data for this account: every brand for a central agency, and
   * only the family's holdings — with the model ceiling — for a sub-agency.
   */
  async brandChoicesFor(id) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');
    if (!agent.parentId) return brandAccess.brandChoices(id);
    return brandAccess.brandChoicesWithin(id, agent.parentId);
  },

  /**
   * Replaces an account's grants. For a sub-agency the central agency's own
   * grants are the ceiling — an administrator divides the family's holdings,
   * it does not extend them past what the family itself may post.
   */
  async setBrands({ id, brandIds, modelIds }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    let limitTo = null;
    let ceilingMessage = null;
    if (agent.parentId) {
      const parent = await brandAccess.allowedSets(agent.parentId);
      limitTo = { brandIds: parent.brandIds, modelIds: parent.modelGrants.map((g) => g.id) };
      ceilingMessage =
        'به زیرمجموعه فقط می‌توان برندها و مدل‌هایی داد که نمایندگی مرکزی‌اش دارد';
    }

    return brandAccess.setBrands({ userId: id, brandIds, modelIds, limitTo, ceilingMessage });
  },

  async get(id) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    // The subscription rides with the file rather than arriving in a second
    // request: «تا کی اشتراک دارد» is one of the two questions this page is
    // opened to answer, and a page that shows the account and then fills in
    // the money a moment later is a page that gets read too early.
    const [stats, subscription] = await Promise.all([
      agentRepository.stats(id),
      subscriptionService.fileFor(id),
    ]);
    return { ...agent, stats, subscription };
  },

  /**
   * Editing the profile.
   *
   * Contact details are locked for the agency itself and changed only here, on
   * the back of a ticket (blueprint 27) — otherwise an agency could take payment
   * for contact reveals and then change the number. Every listing they own reads
   * the profile live, so one edit corrects all of them at once.
   */
  async update({ actor, id, payload }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    await this.assertUnique(payload, id);

    const updated = await agentRepository.update(id, payload);

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'AGENT_UPDATED',
      targetType: 'USER',
      targetId: id,
      summary: Object.keys(payload).join(','),
    });

    return updated;
  },

  async setStatus({ actor, id, status }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    let updated;
    if (status === 'SUSPENDED') {
      [updated] = await agentRepository.suspend(id);
    } else {
      updated = await agentRepository.update(id, { status: 'ACTIVE', suspendedAt: null });
    }

    await authRepository.recordActivity({
      userId: actor.id,
      action: status === 'SUSPENDED' ? 'AGENT_SUSPENDED' : 'AGENT_ACTIVATED',
      targetType: 'USER',
      targetId: id,
      summary: agent.agencyCode,
    });

    return updated;
  },

  async resetPassword({ actor, id, password }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    await agentRepository.update(id, {
      passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
      mustChangePassword: true,
    });
    // Whoever held the old password is signed out at once.
    await agentRepository.endSessions(id);

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'AGENT_PASSWORD_RESET',
      targetType: 'USER',
      targetId: id,
      summary: agent.agencyCode,
    });

    return { reset: true };
  },

  /** Blueprint 3.4: an admin can sign an agency out of wherever it is. */
  async forceLogout({ actor, id }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    const { count } = await agentRepository.endSessions(id);

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'AGENT_FORCE_LOGGED_OUT',
      targetType: 'USER',
      targetId: id,
      summary: agent.agencyCode,
    });

    return { endedSessions: count };
  },

  /**
   * Module mode, and the per-account reveal caps.
   *
   * Both are the levers for handling one large customer without inventing a new
   * plan for them (blueprint 2.6 and 6.4).
   */
  async setLimits({ actor, id, payload }) {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError('نمایندگی');

    // Turning module mode off does not take away sub-agencies that already
    // exist — they are running businesses, not a setting. It only stops new ones.
    if (payload.isReseller === true && !agent.agencyCode) {
      throw new BadRequestError(MESSAGES.SEAT.PARENT_NEEDS_CODE);
    }

    const updated = await agentRepository.update(id, payload);

    await authRepository.recordActivity({
      userId: actor.id,
      action: 'AGENT_LIMITS_CHANGED',
      targetType: 'USER',
      targetId: id,
      summary: JSON.stringify(payload),
    });

    return updated;
  },
};

module.exports = agentService;
