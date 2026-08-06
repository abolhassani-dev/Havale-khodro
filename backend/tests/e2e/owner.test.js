const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const authRepository = require('../../src/modules/auth/auth.repository');
const roles = require('../../src/constants/roles');

/**
 * The account the rest of the system cannot see.
 *
 * The owner needs an account that no administrator knows exists, so that "who
 * can see everything" is not a question anyone in the panel can ask. These
 * tests pin down the three things that has to mean — including the one that
 * pulls the other way, because getting it wrong would have removed brute-force
 * protection from the most privileged account in the system.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('the hidden owner account', () => {
  const created = [];
  let owner;
  let admin;

  const makeUser = async (username, role) => {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: 'x',
        phone: `0912${Math.floor(1000000 + Math.random() * 8999999)}`,
        fullName: username,
        role,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return user;
  };

  beforeAll(async () => {
    await connectDatabase();
    owner = await makeUser(`owner-${Date.now()}`, 'OWNER');
    admin = await makeUser(`admin-${Date.now()}`, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await disconnectDatabase();
  });

  afterEach(async () => {
    await prisma.activityLog.deleteMany({ where: { OR: [{ userId: { in: created } }, { summary: { contains: 'owner-' } }] } });
  });

  describe('the policy', () => {
    it('treats OWNER and DEVELOPER as hidden and nothing else', () => {
      expect(roles.isHidden('OWNER')).toBe(true);
      expect(roles.isHidden('DEVELOPER')).toBe(true);
      expect(roles.isHidden('SUPER_ADMIN')).toBe(false);
      expect(roles.isHidden('AGENT')).toBe(false);
    });

    // Give this to a super admin and the distinction between the roles stops
    // meaning anything, because they can promote themselves.
    it('lets only the owner manage staff', () => {
      expect(roles.can('OWNER', 'staff')).toBe(true);
      expect(roles.can('SUPER_ADMIN', 'staff')).toBe(false);
      expect(roles.can('SUPPORT', 'staff')).toBe(false);
      expect(roles.can('FINANCE', 'staff')).toBe(false);
    });

    it('lets only the owner hand out roles, and never the owner role itself', () => {
      const assignable = roles.assignableRoles('OWNER');
      expect(assignable).toContain('SUPER_ADMIN');
      expect(assignable).toContain('DEVELOPER');
      expect(assignable).not.toContain('OWNER');
      expect(roles.assignableRoles('SUPER_ADMIN')).toEqual([]);
    });

    // The scope of this role is a decision to make with a real person in front
    // of you. Until then it can sign in and do nothing, which is the safe
    // direction to be wrong in.
    it('gives the developer role nothing yet', () => {
      expect(Object.keys(roles.PERMISSIONS.DEVELOPER)).toHaveLength(0);
    });
  });

  describe('the audit trail', () => {
    it('records nothing at all for the owner', async () => {
      await authRepository.recordActivity({
        userId: owner.id,
        action: 'HAVALE_CREATED',
        summary: 'owner did something',
      });

      const rows = await prisma.activityLog.findMany({ where: { userId: owner.id } });
      expect(rows).toHaveLength(0);
    });

    it('still records everybody else', async () => {
      await authRepository.recordActivity({
        userId: admin.id,
        action: 'HAVALE_CREATED',
        summary: 'admin did something',
      });

      const rows = await prisma.activityLog.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(1);
    });

    /**
     * The one that pulls the other way.
     *
     * The lockout counts LOGIN_FAILED rows. Dropping the owner's would have
     * made theirs the single account nobody could ever lock out — the exact
     * opposite of protecting it. So the row is written with no actor attached:
     * the counter still sees it, and it is indistinguishable from a failed
     * attempt on a username that does not exist.
     */
    it('still counts failed logins against the owner, without naming them', async () => {
      await authRepository.recordActivity({
        userId: owner.id,
        action: 'LOGIN_FAILED',
        summary: owner.username,
      });

      const linked = await prisma.activityLog.findMany({ where: { userId: owner.id } });
      expect(linked).toHaveLength(0);

      const counted = await authRepository.countRecentFailures(
        owner.username,
        new Date(Date.now() - 60_000)
      );
      expect(counted).toBe(1);
    });

    it('leaves a failed login on the owner looking like one on a name that does not exist', async () => {
      const ghost = `no-such-${Date.now()}`;

      await authRepository.recordActivity({
        userId: owner.id, action: 'LOGIN_FAILED', summary: owner.username,
      });
      await authRepository.recordActivity({
        userId: null, action: 'LOGIN_FAILED', summary: ghost,
      });

      // Scoped to the two rows this test wrote. The first version asked for
      // every LOGIN_FAILED in the table and passed alone but failed in the full
      // run, because the auth suite leaves its own behind — a test that depends
      // on which other tests ran is not a test.
      const rows = await prisma.activityLog.findMany({
        where: { action: 'LOGIN_FAILED', summary: { in: [owner.username, ghost] } },
        select: { userId: true, summary: true },
      });

      expect(rows).toHaveLength(2);
      // Neither row carries an actor, so the log cannot be used to work out
      // which of the two usernames is real.
      expect(rows.every((r) => r.userId === null)).toBe(true);
    });
  });
});
