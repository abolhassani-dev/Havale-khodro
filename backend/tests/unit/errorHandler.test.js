const errorHandler = require('../../src/middlewares/errorHandler');

/**
 * The unique-constraint net.
 *
 * Services pre-check the common collisions with their own messages, but any
 * path that forgets — or loses the race between check and insert — throws
 * Prisma's P2002. Before the net that became a 500, which production renders
 * as «Something went wrong»: a real user met exactly that on the sub-agency
 * form with a duplicate phone number. The net turns it into a 409 that names
 * the field.
 */
describe('errorHandler on a unique-constraint violation', () => {
  const respond = (err) => {
    let sent;
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { sent = { statusCode: this.statusCode, body }; return this; },
    };
    errorHandler(err, { originalUrl: '/test', id: 'req-1' }, res, () => {});
    return sent;
  };

  const p2002 = (target) => Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target },
  });

  it('answers 409 and names the phone when the phone index collides', () => {
    const out = respond(p2002(['phoneIndex']));
    expect(out.statusCode).toBe(409);
    expect(out.body.error.message).toContain('شماره موبایل');
    expect(out.body.error.message).not.toContain('phoneIndex');
  });

  it('names the username and the agency code for their columns', () => {
    expect(respond(p2002(['username'])).body.error.message).toContain('نام کاربری');
    expect(respond(p2002(['agencyCode'])).body.error.message).toContain('کد نمایندگی');
  });

  it('still answers 409 with a generic message for any other unique column', () => {
    const out = respond(p2002(['somethingElse']));
    expect(out.statusCode).toBe(409);
    expect(out.body.error.message).toBe('این مقدار قبلاً ثبت شده است');
  });
});
