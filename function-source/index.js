'use strict';

const Busboy = require('busboy');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { Readable } = require('stream');
const { google } = require('googleapis');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.uploadExample = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const driveFolderId = (process.env.DRIVE_FOLDER_ID || '').trim();
    const debugUploadToken = (process.env.DEBUG_UPLOAD_TOKEN || '').trim();
    if (!driveFolderId) {
      res.status(500).json({ error: 'missing_drive_folder_id' });
      return;
    }

    const parsed = await parseMultipartForm(req);
    const upload = parsed.files.photo;
    const appCheckToken = parsed.fields.integrity_token;
    const debugAuthToken = parsed.fields.debug_auth_token;
    const description = (parsed.fields.description || '').trim();
    const caloriesRaw = (parsed.fields.calorie_estimate || '').trim();
    const capturedAt = (parsed.fields.captured_at || '').trim();
    const entryId = (parsed.fields.entry_id || '').trim();
    const confidenceState = (parsed.fields.confidence_state || '').trim();

    console.info('uploadExample received request', {
      hasPhoto: Boolean(upload),
      hasAppCheckToken: Boolean(appCheckToken),
      hasDebugAuthToken: Boolean(debugAuthToken),
      entryId: entryId || null,
      descriptionLength: description.length,
      confidenceState: confidenceState || null,
    });
    if (!upload) {
      res.status(400).json({ error: 'missing_photo' });
      return;
    }
    if (!description) {
      res.status(400).json({ error: 'missing_description' });
      return;
    }

    const calorieEstimate = Number.parseInt(caloriesRaw, 10);
    if (!Number.isFinite(calorieEstimate)) {
      res.status(400).json({ error: 'invalid_calorie_estimate' });
      return;
    }

    const isDebugAuthenticated = debugUploadToken && debugAuthToken === debugUploadToken;
    if (!isDebugAuthenticated) {
      if (!appCheckToken) {
        res.status(401).json({ error: 'missing_app_check_token' });
        return;
      }
      const appCheckSummary = await verifyAppCheckToken({
        appCheckToken,
      });
      console.info('uploadExample verified Firebase App Check', {
        entryId: entryId || null,
        appId: appCheckSummary.appId,
      });
    } else {
      console.info('uploadExample authenticated with debug token', {
        entryId: entryId || null,
      });
    }

    const drive = google.drive({ version: 'v3', auth: createDriveAuth() });

    const now = new Date();
    const recordId = `${formatTimestamp(now)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const extension = guessExtension(upload.mimeType, upload.filename);
    const photoName = `${recordId}${extension}`;
    const metadataName = `${recordId}.json`;

    const photoFile = await drive.files.create({
      requestBody: {
        name: photoName,
        parents: [driveFolderId],
        appProperties: {
          description,
          calorieEstimate: String(calorieEstimate),
        },
      },
      media: {
        mimeType: upload.mimeType || 'image/jpeg',
        body: Readable.from(upload.buffer),
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });

    const metadataPayload = {
      record_id: recordId,
      created_at: new Date().toISOString(),
      auth_mode: isDebugAuthenticated ? 'debug_token' : 'firebase_app_check',
      captured_at: capturedAt || null,
      description,
      calorie_estimate: calorieEstimate,
      entry_id: entryId || null,
      confidence_state: confidenceState || null,
      photo: {
        file_id: photoFile.data.id,
        name: photoFile.data.name,
        mime_type: upload.mimeType || 'image/jpeg',
      },
    };

    const metadataFile = await drive.files.create({
      requestBody: {
        name: metadataName,
        parents: [driveFolderId],
      },
      media: {
        mimeType: 'application/json',
        body: Readable.from(Buffer.from(JSON.stringify(metadataPayload, null, 2), 'utf8')),
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });

    res.status(200).json({
      ok: true,
      record_id: recordId,
      photo_file_id: photoFile.data.id,
      metadata_file_id: metadataFile.data.id,
    });
    console.info('uploadExample stored upload', {
      recordId,
      entryId: entryId || null,
      authMode: isDebugAuthenticated ? 'debug_token' : 'firebase_app_check',
      photoFileId: photoFile.data.id,
      metadataFileId: metadataFile.data.id,
      photoMimeType: upload.mimeType || 'image/jpeg',
      calorieEstimate,
      confidenceState: confidenceState || null,
    });
  } catch (error) {
    console.error('uploadExample failed', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'internal_error',
    });
  }
};

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      reject(withStatus(new Error('expected_multipart_form_data'), 400));
      return;
    }

    const fields = {};
    const files = {};
    let totalFileBytes = 0;
    let rejected = false;
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_UPLOAD_BYTES,
      },
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, file, info) => {
      const chunks = [];
      const mimeType = info.mimeType || '';
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        rejected = true;
        file.resume();
        reject(withStatus(new Error('unsupported_photo_type'), 400));
        return;
      }
      file.on('data', (chunk) => {
        if (rejected) return;
        totalFileBytes += chunk.length;
        if (totalFileBytes > MAX_UPLOAD_BYTES) {
          rejected = true;
          reject(withStatus(new Error('photo_too_large'), 413));
          file.resume();
          return;
        }
        chunks.push(chunk);
      });
      file.on('limit', () => {
        if (rejected) return;
        rejected = true;
        reject(withStatus(new Error('photo_too_large'), 413));
      });
      file.on('end', () => {
        if (rejected) return;
        files[name] = {
          filename: info.filename,
          mimeType,
          buffer: Buffer.concat(chunks),
        };
      });
    });

    busboy.on('error', (error) => reject(withStatus(error, 400)));
    busboy.on('finish', () => {
      if (!rejected) {
        resolve({ fields, files });
      }
    });

    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

async function verifyAppCheckToken({ appCheckToken }) {
  try {
    const claims = await admin.appCheck().verifyToken(appCheckToken);
    return {
      appId: claims.appId,
    };
  } catch (error) {
    console.error('App Check verification failed', error);
    throw withStatus(new Error('invalid_app_check_token'), 401);
  }
}

function createDriveAuth() {
  const clientId = (process.env.DRIVE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.DRIVE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.DRIVE_OAUTH_REFRESH_TOKEN || '').trim();
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  return new google.auth.GoogleAuth({
    scopes: [DRIVE_SCOPE],
  });
}

function formatTimestamp(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function guessExtension(mimeType, filename) {
  if (filename && filename.includes('.')) {
    return `.${filename.split('.').pop().toLowerCase()}`;
  }
  if (mimeType === 'image/png') {
    return '.png';
  }
  return '.jpg';
}

function withStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}
