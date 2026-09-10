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
 * What each accepted type looks like in its first bytes.
 *
 * The MIME type multer sees is the one the client wrote into its own request,
 * and a browser will happily label anything `image/png` if a script asks it
 * to. The bytes on disk are the only thing that was not chosen by the
 * uploader, so they decide. WebP is RIFF....WEBP, with a length in the gap.
 */
const SIGNATURES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

function matchesSignature(bytes, mime) {
  const patterns = SIGNATURES[mime];
  if (!patterns) return false;
  return patterns.some((p) => p.every((b, i) => b === null || bytes[i] === b));
}

async function looksLike(file) {
  const fh = await fs.promises.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    return bytesRead >= 4 && matchesSignature(buf, file.mimetype);
  } finally {
    await fh.close();
  }
}

function filesOf(req) {
  const files = req.file ? [req.file] : req.files || [];
  return [].concat(files);
}

/**
 * Checks what was uploaded, and deletes it if the request ends up refused.
 *
 * Two jobs, one place, because every uploader mounts this and nothing else
 * has to remember either:
 *
 *   The file's first bytes must match the type it claimed. A mismatch is
 *   refused as a validation error and the file is gone before any handler
 *   sees it — so what the API later serves under `image/png` is a PNG, and
 *   not an HTML page a browser might be talked into rendering.
 *
 *   Multer writes the file to disk before anything downstream gets to look at
 *   the request, so a schema error or a permission check leaves a file on a
 *   small VPS that no row will ever point at. Whatever the response, a
 *   refused request leaves nothing behind.
 */
function discardOnFailure(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    for (const file of filesOf(req)) {
      fs.unlink(file.path, (err) => {
        if (err) logger.warn('Could not remove an upload from a refused request', { error: err.message });
      });
    }
  });

  const files = filesOf(req);
  if (!files.length) return next();
  return Promise.all(files.map((f) => looksLike(f).catch(() => false))).then((oks) => {
    if (oks.every(Boolean)) return next();
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    err.message = 'محتوای فایل با نوع آن نمی‌خواند — فقط عکس واقعی (JPG، PNG، WebP) یا PDF قابل پیوست است';
    return next(err);
  }, next);
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
