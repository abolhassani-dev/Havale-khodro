const { makeUploader } = require('../../utils/uploads');

/**
 * Ticket attachments — images and PDFs, three per message.
 *
 * The rules live in utils/uploads: generated filenames, verified types, and a
 * directory whose absence can never take the API down. This file only says
 * which folder and how many.
 */
const { upload, dir: UPLOADS_DIR, maxFiles: MAX_FILES } = makeUploader({
  subdir: 'tickets',
  maxFiles: 3,
  typeMessage: 'فقط عکس (JPG، PNG، WebP) یا فایل PDF قابل پیوست است',
});

module.exports = { upload, UPLOADS_DIR, MAX_FILES };
