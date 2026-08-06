/**
 * Roles.
 *
 * The three admin roles exist so that hiring a support person does not hand them
 * the contact data the business rests on — see the access table in
 * docs/blueprint.pdf, clause 11.12.
 *
 * Above them sit two roles that the rest of the system cannot see at all. That
 * is the point of them: the owner needs an account that Mahdi, Erfan, and any
 * future administrator do not know exists, so that "who can see everything" is
 * not a question anyone in the panel can even ask.
 */
const ROLES = {
  OWNER: 'OWNER',
  DEVELOPER: 'DEVELOPER',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPPORT: 'SUPPORT',
  FINANCE: 'FINANCE',
  AGENT: 'AGENT',
};

const ROLE_VALUES = Object.values(ROLES);

/**
 * Roles that do not appear to anybody outside themselves.
 *
 * Enforced at the data layer — in the repository that lists users and in the
 * one function that writes the activity log — and deliberately not screen by
 * screen. A rule applied at twenty call sites is a rule that will be missed at
 * the twenty-first, and the thing missed here is the existence of the account.
 */
const HIDDEN_ROLES = [ROLES.OWNER, ROLES.DEVELOPER];
const isHidden = (role) => HIDDEN_ROLES.includes(role);

/** Everything that runs the business day to day. Not the hidden roles. */
const ADMIN_ROLES = [ROLES.OWNER, ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.FINANCE];
const isAdmin = (role) => ADMIN_ROLES.includes(role);

const isOwner = (role) => role === ROLES.OWNER;

/**
 * Permissions per role, mirroring clause 11.12 of the blueprint.
 * Kept as data rather than scattered `if (role === ...)` checks so the whole
 * policy can be read — and audited — in one place.
 *
 * `catalog` is not in the blueprint's table: the car catalogue was added after
 * it was written. It sits with the super admin because editing it changes what
 * every agency can advertise.
 *
 * `staff` and `systemAlerts` are the owner's alone. `staff` is the ability to
 * create and change the accounts that run the system — give that to a super
 * admin and the distinction between the roles stops meaning anything, because
 * they can simply promote themselves.
 */
const PERMISSIONS = {
  OWNER: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: true,
    subscriptions: true, seats: true, agents: true, monitoring: true,
    export: true, bulkContacts: true, settings: true, catalog: true,
    // Owner only.
    staff: true, systemAlerts: true, errorLog: true,
  },

  // Deliberately empty.
  //
  // The role exists so the enum and the database column are settled, but what a
  // developer should be able to see is a decision to make with a real person in
  // front of you, not a guess months earlier. Until then an account with this
  // role can sign in and do nothing, which is the safe direction to be wrong in.
  DEVELOPER: {},

  SUPER_ADMIN: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: true,
    subscriptions: true, seats: true, agents: true, monitoring: true,
    export: true, bulkContacts: true, settings: true, catalog: true,
    staff: false, systemAlerts: false, errorLog: false,
  },
  SUPPORT: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: false,
    subscriptions: false, seats: false, agents: false, monitoring: false,
    export: false, bulkContacts: false, settings: false, catalog: false,
    staff: false, systemAlerts: false, errorLog: false,
  },
  FINANCE: {
    tickets: false, reports: false, contactEdit: false, thirdStrike: false,
    subscriptions: true, seats: true, agents: false, monitoring: false,
    export: false, bulkContacts: false, settings: false, catalog: false,
    staff: false, systemAlerts: false, errorLog: false,
  },
  AGENT: {},
};

const can = (role, permission) => Boolean(PERMISSIONS[role] && PERMISSIONS[role][permission]);

/**
 * The roles an account may hand out.
 *
 * Only the owner can create staff at all, and only the owner can create another
 * hidden account. Written as a function rather than a constant so that adding a
 * role cannot accidentally make it assignable by everyone.
 */
function assignableRoles(actorRole) {
  if (actorRole !== ROLES.OWNER) return [];
  return [ROLES.DEVELOPER, ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.FINANCE];
}

module.exports = {
  ROLES, ROLE_VALUES, ADMIN_ROLES, HIDDEN_ROLES, PERMISSIONS,
  isAdmin, isHidden, isOwner, can, assignableRoles,
};
