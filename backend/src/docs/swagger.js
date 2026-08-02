const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('../config');

// Generated from route annotations rather than maintained by hand, so the docs
// cannot quietly drift away from the actual API.
const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'havale API',
      version: '1.0.0',
      description: 'API documentation for havale',
    },
    servers: [{ url: config.apiPrefix }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/modules/**/*.routes.js'],
});

module.exports = function mountSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/docs.json', (_req, res) => res.json(spec));
};
