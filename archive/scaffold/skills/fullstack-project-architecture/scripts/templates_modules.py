"""Auth and User module templates — the reference implementation of the layering.

These two modules exist in every generated project so there is always a concrete,
working example of controller → service → repository in the codebase. New modules
are written by following their shape.
"""

# --------------------------------------------------------------------------- #
# User model
# --------------------------------------------------------------------------- #

USER_MODEL_MONGO = """const mongoose = require('mongoose');
const { ROLE_VALUES, ROLES } = require('../../constants/roles');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // `select: false` keeps the hash out of every query result by default, so it
    // cannot reach a response through an oversight.
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.USER, index: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('User', userSchema);
"""

PRISMA_SCHEMA = """generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "{{PRISMA_PROVIDER}}"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  user
}

model User {
  id          String   @id @default(cuid())
  name        String
  email       String   @unique
  password    String
  role        Role     @default(user)
  isActive    Boolean  @default(true)
  lastLoginAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([role, isActive])
}
"""

# --------------------------------------------------------------------------- #
# User repository — the only layer that talks to the database
# --------------------------------------------------------------------------- #

USER_REPOSITORY_MONGO = """const User = require('./user.model');

/**
 * Database access for users. No business rules here — this layer answers "fetch
 * it", never "should we".
 *
 * Keeping it isolated is what makes changing database or ORM a contained edit
 * rather than a rewrite of every service.
 */
const userRepository = {
  create(data) {
    return User.create(data);
  },

  findById(id) {
    return User.findById(id);
  },

  findByEmail(email, { withPassword = false } = {}) {
    const query = User.findOne({ email });
    return withPassword ? query.select('+password') : query;
  },

  async findMany({ page = 1, limit = 20, role, search } = {}) {
    const filter = {};
    if (role) filter.role = role;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const [items, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return { items, total };
  },

  updateById(id, data) {
    return User.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  },

  deleteById(id) {
    return User.findByIdAndDelete(id);
  },

  touchLogin(id) {
    return User.findByIdAndUpdate(id, { lastLoginAt: new Date() });
  },
};

module.exports = userRepository;
"""

USER_REPOSITORY_PRISMA = """const { prisma } = require('../../config/database');

// Never select the password by default — an omission here becomes a leak in
// every endpoint that returns a user.
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Database access for users. No business rules — this layer answers "fetch it",
 * never "should we".
 */
const userRepository = {
  create(data) {
    return prisma.user.create({ data, select: PUBLIC_FIELDS });
  },

  findById(id) {
    return prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  },

  findByEmail(email, { withPassword = false } = {}) {
    return prisma.user.findUnique({
      where: { email },
      select: withPassword ? { ...PUBLIC_FIELDS, password: true } : PUBLIC_FIELDS,
    });
  },

  async findMany({ page = 1, limit = 20, role, search } = {}) {
    const where = {
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: PUBLIC_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  },

  updateById(id, data) {
    return prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
  },

  deleteById(id) {
    return prisma.user.delete({ where: { id }, select: PUBLIC_FIELDS });
  },

  touchLogin(id) {
    return prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },
};

module.exports = userRepository;
"""

# --------------------------------------------------------------------------- #
# User service / controller / routes / validator / dto
# --------------------------------------------------------------------------- #

USER_SERVICE = """const userRepository = require('./user.repository');
const { NotFoundError, ConflictError } = require('../../errors/AppError');
const { toPublicUser } = require('./user.dto');

/**
 * Business rules for users.
 *
 * Nothing here knows about HTTP, which is what lets the same functions be called
 * from a queue worker, a seed script, or a test.
 */
const userService = {
  async list({ page, limit, role, search }) {
    const { items, total } = await userRepository.findMany({ page, limit, role, search });
    return { items: items.map(toPublicUser), total };
  },

  async getById(id) {
    const user = await userRepository.findById(id);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  },

  async create(data) {
    const existing = await userRepository.findByEmail(data.email);
    if (existing) throw new ConflictError('That email is already registered');

    const user = await userRepository.create(data);
    return toPublicUser(user);
  },

  async update(id, data) {
    if (data.email) {
      const existing = await userRepository.findByEmail(data.email);
      // Comparing as strings keeps this correct for both ObjectId and cuid ids.
      if (existing && String(existing.id ?? existing._id) !== String(id)) {
        throw new ConflictError('That email is already registered');
      }
    }

    const user = await userRepository.updateById(id, data);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  },

  async remove(id) {
    const user = await userRepository.deleteById(id);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  },
};

module.exports = userService;
"""

USER_DTO = """/**
 * The boundary between a database record and what leaves the process.
 *
 * Mapping explicitly — rather than returning the record and hoping nothing
 * sensitive is on it — means a new column cannot silently become public.
 */
function toPublicUser(user) {
  if (!user) return null;
  const u = typeof user.toObject === 'function' ? user.toObject() : user;

  return {
    id: String(u.id ?? u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  };
}

module.exports = { toPublicUser };
"""

USER_CONTROLLER = """const userService = require('./user.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created, noContent, paginated } = require('../../responses/apiResponse');
const { MESSAGES } = require('../../constants/messages');

// Read the request, call one service method, shape the response. Nothing else
// belongs here — the moment a controller queries the database, that logic stops
// being testable or reusable.
const userController = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, role, search } = req.query;
    const { items, total } = await userService.list({ page, limit, role, search });
    return paginated(res, items, { page, limit, total });
  }),

  getById: asyncHandler(async (req, res) => {
    const user = await userService.getById(req.params.id);
    return success(res, user);
  }),

  create: asyncHandler(async (req, res) => {
    const user = await userService.create(req.body);
    return created(res, user, MESSAGES.USER.CREATED);
  }),

  update: asyncHandler(async (req, res) => {
    const user = await userService.update(req.params.id, req.body);
    return success(res, user, MESSAGES.USER.UPDATED);
  }),

  remove: asyncHandler(async (req, res) => {
    await userService.remove(req.params.id);
    return noContent(res);
  }),
};

module.exports = userController;
"""

USER_VALIDATOR = """const Joi = require('joi');
const { ROLE_VALUES } = require('../../constants/roles');

const idParam = Joi.object({
  id: Joi.string().required(),
});

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  role: Joi.string().valid(...ROLE_VALUES),
  search: Joi.string().trim().max(120).allow(''),
});

const createBody = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid(...ROLE_VALUES),
});

const updateBody = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  email: Joi.string().email().lowercase(),
  role: Joi.string().valid(...ROLE_VALUES),
  isActive: Joi.boolean(),
}).min(1);

module.exports = {
  list: { query: listQuery },
  getById: { params: idParam },
  create: { body: createBody },
  update: { params: idParam, body: updateBody },
  remove: { params: idParam },
};
"""

USER_ROUTES = """const { Router } = require('express');

const controller = require('./user.controller');
const schema = require('./user.validator');
const validate = require('../../middlewares/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 *     parameters:
 *       - { in: query, name: page,   schema: { type: integer } }
 *       - { in: query, name: limit,  schema: { type: integer } }
 *       - { in: query, name: role,   schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated users }
 *   post:
 *     tags: [Users]
 *     summary: Create a user
 *     responses:
 *       201: { description: Created }
 */
router
  .route('/')
  .get(authorize(ROLES.ADMIN), validate(schema.list), controller.list)
  .post(authorize(ROLES.ADMIN), validate(schema.create), controller.create);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The user }
 *       404: { description: Not found }
 */
router
  .route('/:id')
  .get(validate(schema.getById), controller.getById)
  .patch(authorize(ROLES.ADMIN), validate(schema.update), controller.update)
  .delete(authorize(ROLES.ADMIN), validate(schema.remove), controller.remove);

module.exports = router;
"""

USER_TEST = """const userService = require('../../src/modules/user/user.service');
const userRepository = require('../../src/modules/user/user.repository');
const { ConflictError, NotFoundError } = require('../../src/errors/AppError');

jest.mock('../../src/modules/user/user.repository');

describe('userService', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses to create a second account on the same email', async () => {
    userRepository.findByEmail.mockResolvedValue({ id: '1', email: 'taken@example.com' });

    await expect(
      userService.create({ name: 'A', email: 'taken@example.com', password: 'x' })
    ).rejects.toThrow(ConflictError);

    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('raises NotFound rather than returning null for a missing user', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expect(userService.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('never returns the password field', async () => {
    userRepository.findById.mockResolvedValue({
      id: '1',
      name: 'A',
      email: 'a@example.com',
      role: 'user',
      isActive: true,
      password: 'should-never-escape',
    });

    const user = await userService.getById('1');
    expect(user).not.toHaveProperty('password');
  });
});
"""

# --------------------------------------------------------------------------- #
# Auth module
# --------------------------------------------------------------------------- #

AUTH_SERVICE = """const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const config = require('../../config');
const userRepository = require('../user/user.repository');
const { toPublicUser } = require('../user/user.dto');
const { UnauthorizedError, ConflictError } = require('../../errors/AppError');
const { MESSAGES } = require('../../constants/messages');
const { ROLES } = require('../../constants/roles');

function issueTokens(user) {
  const payload = { sub: String(user.id ?? user._id), role: user.role };

  return {
    accessToken: jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn }),
    refreshToken: jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
    }),
  };
}

const authService = {
  async register({ name, email, password }) {
    const existing = await userRepository.findByEmail(email);
    if (existing) throw new ConflictError(MESSAGES.AUTH.EMAIL_TAKEN);

    const hashed = await bcrypt.hash(password, config.security.bcryptRounds);
    const user = await userRepository.create({
      name,
      email,
      password: hashed,
      role: ROLES.USER,
    });

    return { user: toPublicUser(user), tokens: issueTokens(user) };
  },

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email, { withPassword: true });

    // One message for both "no such account" and "wrong password". Distinguishing
    // them tells an attacker which emails are registered.
    if (!user) throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);

    if (!user.isActive) throw new UnauthorizedError('Account is disabled');

    await userRepository.touchLogin(user.id ?? user._id);

    return { user: toPublicUser(user), tokens: issueTokens(user) };
  },

  async refresh(refreshToken) {
    let payload;
    try {
      payload = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      throw new UnauthorizedError(MESSAGES.AUTH.TOKEN_INVALID);
    }

    const user = await userRepository.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedError(MESSAGES.AUTH.TOKEN_INVALID);

    return { tokens: issueTokens(user) };
  },

  async me(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new UnauthorizedError();
    return toPublicUser(user);
  },
};

module.exports = authService;
"""

AUTH_CONTROLLER = """const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { MESSAGES } = require('../../constants/messages');

const authController = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    return created(res, result, MESSAGES.AUTH.REGISTERED);
  }),

  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    return success(res, result, MESSAGES.AUTH.LOGGED_IN);
  }),

  refresh: asyncHandler(async (req, res) => {
    const result = await authService.refresh(req.body.refreshToken);
    return success(res, result);
  }),

  me: asyncHandler(async (req, res) => {
    const user = await authService.me(req.user.sub);
    return success(res, user);
  }),
};

module.exports = authController;
"""

AUTH_VALIDATOR = """const Joi = require('joi');

const registerBody = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email().lowercase().required(),
  // Minimum length is the control that matters most here; complexity rules push
  // users toward predictable substitutions without adding much real entropy.
  password: Joi.string().min(8).max(128).required(),
});

const loginBody = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const refreshBody = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = {
  register: { body: registerBody },
  login: { body: loginBody },
  refresh: { body: refreshBody },
};
"""

AUTH_ROUTES = """const { Router } = require('express');

const controller = require('./auth.controller');
const schema = require('./auth.validator');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');
const { authLimiter } = require('../../middlewares/rateLimiter');

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create an account
 *     security: []
 *     responses:
 *       201: { description: Registered }
 *       409: { description: Email already registered }
 */
router.post('/register', authLimiter, validate(schema.register), controller.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in
 *     security: []
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid credentials }
 */
router.post('/login', authLimiter, validate(schema.login), controller.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access token
 *     security: []
 *     responses:
 *       200: { description: New tokens }
 */
router.post('/refresh', validate(schema.refresh), controller.refresh);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: The signed-in user
 *     responses:
 *       200: { description: Profile }
 *       401: { description: Not authenticated }
 */
router.get('/me', authenticate, controller.me);

module.exports = router;
"""
