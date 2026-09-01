const { makeUploader } = require('../../utils/uploads');
const { LIMITS } = require('./car.constants');

/**
 * Car photos — images only, six per advertisement.
 *
 * No PDF here: a photo of a car is a picture or it is nothing. The shared
 * factory supplies the rules that matter — generated names, verified types,
 * a directory whose absence cannot take the API down.
 */
const { upload, dir: UPLOADS_DIR, maxFiles: MAX_FILES } = makeUploader({
  subdir: 'cars',
  maxFiles: LIMITS.PHOTO_MAX,
  mimes: ['image/jpeg', 'image/png', 'image/webp'],
  typeMessage: 'فقط عکس (JPG، PNG، WebP) قابل بارگذاری است',
});

module.exports = { upload, UPLOADS_DIR, MAX_FILES };
