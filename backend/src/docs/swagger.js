const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('../config');
const { BRAND } = require('../constants/brand');

// Generated from route annotations rather than maintained by hand, so the docs
// cannot quietly drift away from the actual API.
const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: `${BRAND.name} API`,
      version: '1.0.0',
      description: BRAND.nameFa,
    },
    servers: [{ url: config.apiPrefix }],
    components: {
      securitySchemes: {
        // A cookie, not a bearer token. The scaffold declared a JWT scheme this
        // system never had, which would send the first developer reading these
        // docs looking for an Authorization header that does not exist — and
        // quietly suggest keeping a token where JavaScript can read it, which is
        // the thing httpOnly exists to prevent.
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: config.session.cookieName,
          description:
            'Set by POST /auth/login. httpOnly and SameSite=Strict: the browser attaches it automatically and JavaScript cannot read it.',
        },
      },
    },
    security: [{ cookieAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/modules/**/*.routes.js'],
});

module.exports = function mountSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/docs.json', (_req, res) => res.json(spec));
};
