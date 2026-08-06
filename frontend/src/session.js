import { auth, subscription } from './api/index.js';
import { getState, setState } from './state/store.js';
import { on } from './api/client.js';
import { toast } from './ui/feedback.js';

/**
 * Who is signed in, and what they are currently entitled to.
 *
 * Both are read from the server. The subscription state in particular is never
 * inferred on this side: an interface that decided for itself whether an
 * agency's subscription was live would eventually disagree with the server, and
 * the user would see buttons that fail when pressed.
 */
export async function boot() {
  try {
    const user = await auth.me();
    // Only an agency has a subscription. This used to ask for one on behalf of
    // anybody who was not an administrator, which was the same thing until the
    // DEVELOPER role existed — a role that is neither. The 403 that came back
    // landed in the catch below, which clears the user, so the account signed in
    // successfully and was thrown straight back to the login screen with nothing
    // said. Asking on the role rather than on "not an admin" is the difference
    // between one condition and its accidental complement.
    const isAgent = user.role === 'AGENT';
    const access = isAgent && !user.mustChangePassword ? await subscription.me() : null;
    setState({ user, access });
    return user;
  } catch {
    setState({ user: null, access: null });
    return null;
  }
}

/** Refreshes entitlement after something that could have changed it. */
export async function refreshAccess() {
  if (getState().user?.role !== 'AGENT') return;
  try {
    setState({ access: await subscription.me() });
  } catch {
    // Not worth interrupting the user over: the next page load will retry, and
    // the server enforces the real rule regardless of what is on screen.
  }
}

/**
 * Session endings the user did not ask for.
 *
 * Each one gets its own sentence. "Please sign in again" for all three would
 * leave somebody who was thrown off by their colleague signing in believing the
 * system logs people out at random — and that call goes to support.
 */
export function watchSession() {
  on('kicked', () => {
    setState({ user: null, access: null });
    toast('از دستگاه دیگری وارد حساب شده‌اید', 'danger');
    window.location.hash = '';
  });

  on('suspended', (error) => {
    setState({ user: null, access: null });
    toast(error.message, 'danger');
    window.location.hash = '';
  });

  on('unauthenticated', () => {
    setState({ user: null, access: null });
    window.location.hash = '';
  });
}
