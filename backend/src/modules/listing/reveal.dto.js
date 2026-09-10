/**
 * What a paid reveal hands back — the one shape, for every market.
 *
 * A `.dto.js` file, like havale.dto.js, because the rule this project audits
 * itself against is that a telephone number is read off a row only inside a
 * serialiser: one kind of file decides who may see a number, and a grep for
 * `.coordinatorPhone` outside them is a finding. The reveal is the moment the
 * number is legitimately shown, and this is where that happens.
 */

/** Who to call, once the viewer has paid to know. */
function contactOf(owner) {
  return {
    coordinatorName: owner.coordinatorName,
    coordinatorPhone: owner.coordinatorPhone,
    phone: owner.phone,
  };
}

/** The agency behind a listing — never sensitive, shown on every card. */
function agencyOf(owner) {
  return { code: owner.agencyCode, name: owner.agencyName, city: owner.city };
}

/** What the caller hands back to the viewer once the reveal is paid for. */
function toRevealResult(owner, usage) {
  return { contact: contactOf(owner), agency: agencyOf(owner), usage };
}

module.exports = { toRevealResult, contactOf, agencyOf };
