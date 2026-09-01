const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const logger = require('./logger');

/**
 * Files people attach: ticket screenshots, payment receipts.
 *
 * One factory rather than a copy per feature, because the rules that matter
 * here are the ones nobody should be free to get slightly different:
 *
 *   The stored filename is generated here and never comes from the client. A
 *   user-supplied name used as a path is a directory-traversal bug waiting for
 *   its first `../`, and the original name is display text only.
 *
 *   The extension comes from the verified MIME type, so a file cannot claim to
 *   be something it is not by its name alone.
 *
 *   Preparing the directory is never fatal. A production deploy once died in a
 *   restart loop because a mkdir threw while a module was loading — one
 *   optional feature with the whole platform behind it. If the directory is
 *   unusable the API starts anyway and only uploads fail, with a message that
 *   says so.
 */

const ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function makeUploader({ subdir, maxFiles = 3, typeMessage, mimes }) {
  // `mimes` narrows the accepted types below the shared map — car photos take
  // images only, where a ticket may also attach a PDF. Additive: leaving it
  // out keeps every existing uploader exactly as it was.
  const accepted = mimes
    ? Object.fromEntries(Object.entries(EXT_BY_MIME).filter(([m]) => mimes.includes(m)))
    : EXT_BY_MIME;
  const dir = path.join(ROOT, subdir);

  let ready = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    ready = true;
  } catch (err) {
    logger.error('Uploads unavailable — the directory is not writable', {
      dir,
      error: err.message,
    });
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.${accepted[file.mimetype]}`),
    }),
    limits: { fileSize: MAX_FILE_BYTES, files: maxFiles },
    fileFilter: (req, file, cb) => {
      if (!ready) {
        const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
        err.message = 'بارگذاری فایل موقتاً در دسترس نیست.';
        return cb(err);
      }
      if (accepted[file.mimetype]) return cb(null, true);
      // Multer surfaces this through the error handler as a 400.
      const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
      err.message = typeMessage || 'فقط عکس (JPG، PNG، WebP) یا فایل PDF قابل پیوست است';
      return cb(err);
    },
  });

  return { upload, dir, isReady: () => ready, maxFiles, discardOnFailure };
}

/**
 * Deletes what was uploaded if the request ends up refused.
 *
 * Multer writes the file to disk before anything downstream gets to look at
 * the request, so a schema error or a permission check leaves a file on a
 * small VPS that no row will ever point at. Mounted straight after the upload
 * middleware, so nothing else has to remember.
 */
function discardOnFailure(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const files = req.file ? [req.file] : req.files || [];
    for (const file of [].concat(files)) {
      fs.unlink(file.path, (err) => {
        if (err) logger.warn('Could not remove an upload from a refused request', { error: err.message });
      });
    }
  });
  return next();
}

/** What multer hands over, in the shape the database stores. */
function toStoredFile(file) {
  if (!file) return null;
  return {
    // The original name arrives latin1-mangled from the multipart headers.
    name: Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200),
    mime: file.mimetype,
    size: file.size,
    storedAs: file.filename,
  };
}

module.exports = { makeUploader, toStoredFile, discardOnFailure, ROOT, MAX_FILE_BYTES };
