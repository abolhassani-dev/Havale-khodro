const bcrypt = require('bcryptjs');

const config = require('../../config');
const { prisma } = require('../../config/database');
const { forgetHiddenActor } = require('../auth/auth.repository');
const {
  ROLES, HIDDEN_ROLES, PERMISSION_GROUPS, PERMISSION_KEYS,
  PERMISSIONS, effectivePermissions, assignableRoles, isHidden,
} = require('../../constants/roles');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../errors/AppError');

/**
 * The accounts that run the system — and who is allowed to change them.
 *
 * Every function here takes the acting user rather than trusting the route, so
 * the rules cannot be bypassed by reaching a handler another way. The rules
 * themselves are short and all in one place on purpose:
 *
 *   - only the owner may be here at all
 *   - the owner role can never be handed out, not even by the owner. There is
 *     one, it was made on the server, and a screen that could mint another is a
 *     screen worth attacking.
 *   - a hidden account is invisible to everybody, and that includes not being
 *     returned by this module to anyone who is not themselves hidden.
 */

const SELECT = {
  id: true, username: true, fullName: true, phone: true, role: true, status: true,
  permissions: true, lastLoginAt: true, createdAt: true,
};

function assertOwner(actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new ForbiddenError();
}

/** Keeps only keys that are real permissions, so nothing arbitrary is stored. */
function cleanPermissions(input) {
  if (!input || typeof input !== 'object') return null;

  const out = {};
  for (const key of PERMISSION_KEYS) {
    if (key in input) out[key] = Boolean(input[key]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Drops a stored override that merely repeats what the role already says.
 *
 * Without this, every account saved from the screen would carry a full copy of
 * its role's defaults — and would then stop following the role. Change what
 * SUPPORT means a year later and none of them would move, because each is
 * pinned to the answer that was correct on the day somebody pressed save.
 */
function onlyDifferences(role, permissions) {
  if (!permissions) return null;
  const base = PERMISSIONS[role] || {};

  const diff = {};
  for (const [key, value] of Object.entries(permissions)) {
    if (Boolean(base[key]) !== value) diff[key] = value;
  }
  return Object.keys(diff).length ? diff : null;
}

function toStaff(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    permissions: effectivePermissions(user),
    // What differs from the role, so the screen can say "این حساب سفارشی است".
    customised: Boolean(user.permissions && Object.keys(user.permissions).length),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

const staffService = {
  /** The checkbox layout and the roles this actor may assign. */
  options(actor) {
    assertOwner(actor);
    return {
      groups: PERMISSION_GROUPS,
      roles: assignableRoles(actor.role).map((role) => ({
        role,
        defaults: PERMISSIONS[role] || {},
      })),
    };
  },

  async list(actor) {
    assertOwner(actor);

    // Everyone who is not an agency — including the hidden accounts, because
    // the owner is the one viewer they are not hidden from.
    const rows = await prisma.user.findMany({
      where: { role: { not: ROLES.AGENT } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    });

    return { items: rows.map(toStaff) };
  },

  async create({ actor, payload }) {
    assertOwner(actor);

    const allowed = assignableRoles(actor.role);
    if (!allowed.includes(payload.role)) {
      // Covers OWNER explicitly: it is not in the assignable list, so there is
      // no path through this screen that creates a second one.
      throw new ValidationError('این نقش قابل واگذاری نیست');
    }

    const taken = await prisma.user.findUnique({
      where: { username: payload.username },
      select: { id: true },
    });
    if (taken) throw new ValidationError('این نام کاربری قبلاً استفاده شده است');

    // The phone is unique across every account, agencies included. Left to the
    // database it fails as a 500; asked here it is an answer.
    const phoneTaken = await prisma.user.findFirst({
      where: { phone: payload.phone },
      select: { id: true },
    });
    if (phoneTaken) throw new ValidationError('این شماره موبایل قبلاً ثبت شده است');

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        passwordHash: await bcrypt.hash(payload.password, config.security.bcryptRounds),
        phone: payload.phone,
        fullName: payload.fullName,
        role: payload.role,
        status: 'ACTIVE',
        permissions: onlyDifferences(payload.role, cleanPermissions(payload.permissions)),
        // They did not choose this password; the owner typed it. It gets
        // replaced on first sign-in like every other handed-out password.
        mustChangePassword: true,
      },
      select: SELECT,
    });

    forgetHiddenActor(user.id);
    return toStaff(user);
  },

  async update({ actor, id, payload }) {
    assertOwner(actor);

    const target = await prisma.user.findUnique({ where: { id }, select: SELECT });
    if (!target || target.role === ROLES.AGENT) throw new NotFoundError('کاربر');

    // The owner account is not editable from here — not its role, not its
    // permissions, not its status. Locking yourself out of your own system
    // through a checkbox should not be one keystroke away.
    if (target.role === ROLES.OWNER) {
      throw new ForbiddenError('حساب مالک از این صفحه قابل تغییر نیست');
    }

    const data = {};
    if (payload.fullName !== undefined) data.fullName = payload.fullName;
    if (payload.phone !== undefined) {
      const clash = await prisma.user.findFirst({
        where: { phone: payload.phone, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new ValidationError('این شماره موبایل قبلاً ثبت شده است');
      data.phone = payload.phone;
    }
    if (payload.status !== undefined) data.status = payload.status;

    const role = payload.role !== undefined ? payload.role : target.role;
    if (payload.role !== undefined) {
      if (!assignableRoles(actor.role).includes(payload.role)) {
        throw new ValidationError('این نقش قابل واگذاری نیست');
      }
      data.role = payload.role;
    }

    if (payload.permissions !== undefined) {
      data.permissions = onlyDifferences(role, cleanPermissions(payload.permissions));
    } else if (payload.role !== undefined) {
      // The role changed and no boxes were sent: the old overrides described a
      // different job. Keeping them would silently carry a support person's
      // exceptions onto a finance account.
      data.permissions = null;
    }

    const user = await prisma.user.update({ where: { id }, data, select: SELECT });

    // A role change can make an account hidden, or stop it being hidden. The
    // activity log caches that answer.
    forgetHiddenActor(id);

    // Their session is carrying the old permissions. Ending it means the change
    // takes effect now rather than whenever they next happen to sign out.
    if (payload.role !== undefined || payload.permissions !== undefined || payload.status === 'SUSPENDED') {
      await prisma.authSession.updateMany({
        where: { userId: id, endedAt: null },
        // ADMIN_REVOKED, because that is what happened and the enum already
        // has a word for it. Inventing a value the column cannot hold turns a
        // permission change into a 500.
        data: { endedAt: new Date(), endReason: 'ADMIN_REVOKED' },
      });
    }

    return toStaff(user);
  },

  async resetPassword({ actor, id, password }) {
    assertOwner(actor);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target || target.role === ROLES.AGENT) throw new NotFoundError('کاربر');
    if (target.role === ROLES.OWNER) throw new ForbiddenError('رمز حساب مالک از اینجا عوض نمی‌شود');

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
        mustChangePassword: true,
      },
    });

    await prisma.authSession.updateMany({
      where: { userId: id, endedAt: null },
      data: { endedAt: new Date(), endReason: 'ADMIN_REVOKED' },
    });

    return { ok: true };
  },
};

module.exports = { staffService, HIDDEN_ROLES, isHidden };
