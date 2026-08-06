const { ROLES, isAdmin, effectivePermissions } = require('../../constants/roles');

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

    // The resolved answer for this account — role defaults with its own ticks
    // applied — rather than the role alone. The interface used to keep its own
    // copy of the policy table and decide from that, and the two had already
    // drifted: the frontend's SUPER_ADMIN was missing `export`. Sending the
    // answer instead of the rules means there is only one policy.
    permissions: effectivePermissions(user),

    // Only an agency has one. Asked as "not an admin", this handed a developer
    // account an agency object full of undefined — which is not null, so every
    // `if (user.agency)` downstream believed it.
    agency:
      user.role === ROLES.AGENT
        ? {
            code: user.agencyCode,
            name: user.agencyName,
            city: user.city,
            coordinatorName: user.coordinatorName,
            coordinatorPhone: user.coordinatorPhone,
          }
        : null,

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
