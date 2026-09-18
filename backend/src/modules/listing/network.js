const { prisma } = require('../../config/database');
const { BadRequestError } = require('../../errors/AppError');
const { MESSAGES } = require('../../constants/messages');

/**
 * «شبکه»: a main agency and the sub-agencies under it — and «فقط شبکه‌ی من».
 *
 * An advertisement may be posted for the network alone (`visibility:
 * NETWORK`). Every market honours that through this one file, in three
 * places: what a list query is allowed to return, whether a row fetched by
 * id may be shown to this viewer, and whether this account is even in a
 * position to post such a thing. One rule, one place — a market that grew
 * its own copy would be the market that leaks a network's listing the day
 * the copies drift.
 *
 * The network is one level deep by product rule (a sub-agency has no
 * sub-agencies), so «the network of X» is the account whose `parentId`
 * everyone shares: the parent itself for a reseller, `parentId` for a child,
 * nothing for an independent agency.
 */

const VISIBILITY = { PUBLIC: 'PUBLIC', NETWORK: 'NETWORK' };

/** The root account of this user's network, or null when there is none. */
function networkRootOf(user) {
  if (!user) return null;
  return user.parentId || (user.isReseller ? user.id : null);
}

/** Every account id in the network under a root: the root and its children. */
async function networkMemberIds(rootId) {
  const rows = await prisma.user.findMany({
    where: { OR: [{ id: rootId }, { parentId: rootId }] },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * The clause a market's public list must AND into its `where`.
 *
 * Public rows always; network rows only when they belong to this viewer's
 * own network. Returned as a fragment for `AND` rather than assigned to
 * `where.OR`, because the حواله list already uses `OR` for the «any colour»
 * rule and the two would overwrite each other.
 */
async function visibilityClause(user) {
  const rootId = networkRootOf(user);
  if (!rootId) return { visibility: VISIBILITY.PUBLIC };
  const members = await networkMemberIds(rootId);
  return {
    OR: [
      { visibility: VISIBILITY.PUBLIC },
      { visibility: VISIBILITY.NETWORK, ownerId: { in: members } },
    ],
  };
}

/**
 * Whether this viewer may see a particular row — the by-id twin of the
 * clause above, so a link is not a way around the list filter. The owner
 * needs `id` and `parentId` loaded.
 */
function mayView(user, row) {
  if (row.visibility !== VISIBILITY.NETWORK) return true;
  const rootId = networkRootOf(user);
  if (!rootId) return false;
  const ownerRoot = row.owner?.parentId || row.ownerId;
  return ownerRoot === rootId;
}

/**
 * What the write is allowed to store. Defaults to public; refuses «network
 * only» from an account that has no network to show it to — the panel never
 * offers the switch to such an account, so reaching this is a hand-built
 * request, and the answer is a plain 400 rather than a silently public row.
 */
function resolveVisibility(user, requested) {
  if (!requested || requested === VISIBILITY.PUBLIC) return VISIBILITY.PUBLIC;
  if (!networkRootOf(user)) throw new BadRequestError(MESSAGES.LISTING.NETWORK_ONLY_NO_NETWORK);
  return VISIBILITY.NETWORK;
}

/** The «فقط شبکه‌ی من» *filter* — the viewer's own network's rows, whatever their visibility. */
async function networkFilter(user) {
  const rootId = networkRootOf(user);
  if (!rootId) return null;
  return { ownerId: { in: await networkMemberIds(rootId) } };
}

module.exports = {
  VISIBILITY,
  networkRootOf,
  networkMemberIds,
  visibilityClause,
  mayView,
  resolveVisibility,
  networkFilter,
};
