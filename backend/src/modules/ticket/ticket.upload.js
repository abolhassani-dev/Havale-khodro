const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

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
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    // Multer surfaces this through the error handler as a 400 — see the
    // MulterError branch there.
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    err.message = 'فقط عکس (JPG، PNG، WebP) یا فایل PDF قابل پیوست است';
    return cb(err);
  },
});

module.exports = { upload, UPLOADS_DIR, MAX_FILES };
