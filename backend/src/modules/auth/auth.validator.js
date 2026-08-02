const Joi = require('joi');

const loginBody = Joi.object({
  username: Joi.string().trim().lowercase().min(3).max(60).required(),
  password: Joi.string().min(1).max(128).required(),
});

const changePasswordBody = Joi.object({
  currentPassword: Joi.string().required(),
  // Length is the control that carries the weight. Complexity rules mostly push
  // people toward predictable substitutions without adding real entropy.
  newPassword: Joi.string().min(8).max(128).required(),
});

module.exports = {
  login: { body: loginBody },
  changePassword: { body: changePasswordBody },
};
