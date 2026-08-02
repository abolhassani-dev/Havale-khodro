/**
 * Roles.
 *
 * The three admin roles exist so that hiring a support person does not hand them
 * the contact data the business rests on — see the access table in
 * docs/blueprint.pdf, clause 11.12.
 */
const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPPORT: 'SUPPORT',
  FINANCE: 'FINANCE',
  AGENT: 'AGENT',
};

const ROLE_VALUES = Object.values(ROLES);
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.SUPPORT, ROLES.FINANCE];

const isAdmin = (role) => ADMIN_ROLES.includes(role);

/**
 * Permissions per admin role, mirroring clause 11.12 of the blueprint.
 * Kept as data rather than scattered `if (role === ...)` checks so the whole
 * policy can be read — and audited — in one place.
 *
 * `catalog` is not in the blueprint's table: the car catalogue was added after
 * it was written. It sits with the super admin because editing it changes what
 * every agency can advertise.
 */
const PERMISSIONS = {
  SUPER_ADMIN: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: true,
    subscriptions: true, seats: true, agents: true, monitoring: true,
    export: true, bulkContacts: true, settings: true, catalog: true,
  },
  SUPPORT: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: false,
    subscriptions: false, seats: false, agents: false, monitoring: false,
    export: false, bulkContacts: false, settings: false, catalog: false,
  },
  FINANCE: {
    tickets: false, reports: false, contactEdit: false, thirdStrike: false,
    subscriptions: true, seats: true, agents: false, monitoring: false,
    export: false, bulkContacts: false, settings: false, catalog: false,
  },
  AGENT: {},
};

const can = (role, permission) => Boolean(PERMISSIONS[role] && PERMISSIONS[role][permission]);

module.exports = { ROLES, ROLE_VALUES, ADMIN_ROLES, PERMISSIONS, isAdmin, can };
