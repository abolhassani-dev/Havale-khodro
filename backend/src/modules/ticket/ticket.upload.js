const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const logger = require('../../utils/logger');

/**
 * Ticket attachments: images and PDFs, nothing else.
 *
 * The stored filename is generated here and never comes from the client — the
 * original name goes to the database for display only. A user-supplied name
 * used as a path is a directory-traversal bug waiting for its first `../`.
 *
 * The extension comes from the verified MIME type, not from the upload, so a
 * file can never claim to be something it is not by its name alone.
 */

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'tickets');

/**
 * Prepared at boot, and never fatal.
 *
 * This used to be a bare mkdirSync at import time. On the first production
 * deploy the named volume had been created root-owned by something else, the
 * mkdir threw EACCES while the module was loading, and the whole API died in a
 * restart loop — the entire platform down because one optional feature could
 * not find a folder. An attachment must never have that power: if the
 * directory is unusable the API starts anyway, and uploads alone fail with a
 * message that says what is wrong.
 */
let uploadsReady = false;
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
  uploadsReady = true;
} catch (err) {
  logger.error('Ticket attachments are unavailable — the upload directory is not writable', {
    dir: UPLOADS_DIR,
    error: err.message,
  });
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.${EXT_BY_MIME[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (!uploadsReady) {
      const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
      err.message = 'بارگذاری فایل موقتاً در دسترس نیست — پیام را بدون پیوست بفرستید.';
      return cb(err);
    }
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    // Multer surfaces this through the error handler as a 400 — see the
    // MulterError branch there.
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    err.message = 'فقط عکس (JPG، PNG، WebP) یا فایل PDF قابل پیوست است';
    return cb(err);
  },
});

module.exports = { upload, UPLOADS_DIR, MAX_FILES };
