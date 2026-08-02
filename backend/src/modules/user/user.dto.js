const { isAdmin } = require('../../constants/roles');

/**
 * The boundary between a database row and what leaves the process.
 *
 * Mapping explicitly — rather than returning the record and trusting that nothing
 * sensitive is on it — means a column added later cannot silently become public.
 * `passwordHash` is the obvious one, but the same applies to every future field.
 */
function toPublicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    isAdmin: isAdmin(user.role),

    agency: isAdmin(user.role)
      ? null
      : {
          code: user.agencyCode,
          name: user.agencyName,
          city: user.city,
          coordinatorName: user.coordinatorName,
          coordinatorPhone: user.coordinatorPhone,
        },

    isReseller: user.isReseller,
    parentId: user.parentId,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * What an agent may see about *another* agency.
 *
 * Contact details and the agency code are deliberately absent: they are only
 * ever added by the reveal flow, after it has been recorded and charged against
 * the daily cap. Building that omission into the mapper — rather than relying on
 * each caller to strip them — is what stops the number leaking through some
 * endpoint nobody thought about.
 */
function toMaskedAgency(user) {
  if (!user) return null;
  return { id: user.id, agencyName: user.agencyName, contactHidden: true };
}

module.exports = { toPublicUser, toMaskedAgency };
