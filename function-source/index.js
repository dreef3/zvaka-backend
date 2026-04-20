'use strict';

const Busboy = require('busboy');
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_TOKEN_AGE_MS = 5 * 60 * 1000;
const ACCEPTED_DEVICE_VERDICTS = new Set([
  'MEETS_STRONG_INTEGRITY',
  'MEETS_DEVICE_INTEGRITY',
]);

exports.uploadExample = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const driveFolderId = (process.env.DRIVE_FOLDER_ID || '').trim();
    const allowedPackageName = (process.env.ALLOWED_PACKAGE_NAME || '').trim();
    const debugUploadToken = (process.env.DEBUG_UPLOAD_TOKEN || '').trim();
    if (!driveFolderId) {
      res.status(500).json({ error: 'missing_drive_folder_id' });
      return;
    }
    if (!allowedPackageName) {
      res.status(500).json({ error: 'missing_allowed_package_name' });
      return;
    }

    const parsed = await parseMultipartForm(req);
    const upload = parsed.files.photo;
    const integrityToken = parsed.fields.integrity_token;
    const debugAuthToken = parsed.fields.debug_auth_token;
    const description = (parsed.fields.description || '').trim();
    const caloriesRaw = (parsed.fields.calorie_estimate || '').trim();
    const capturedAt = (parsed.fields.captured_at || '').trim();
    const entryId = (parsed.fields.entry_id || '').trim();
    const confidenceState = (parsed.fields.confidence_state || '').trim();

    console.info('uploadExample received request', {
      hasPhoto: Boolean(upload),
      hasIntegrityToken: Boolean(integrityToken),
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

    const requestHash = computeRequestHash({
      photoBytes: upload.buffer,
      description,
      calorieEstimate,
      capturedAt,
      entryId,
      confidenceState,
    });

    const isDebugAuthenticated = debugUploadToken && debugAuthToken === debugUploadToken;
    if (!isDebugAuthenticated) {
      if (!integrityToken) {
        res.status(401).json({ error: 'missing_integrity_token' });
        return;
      }
      const integritySummary = await verifyIntegrityToken({
        integrityToken,
        allowedPackageName,
        expectedRequestHash: requestHash,
      });
      console.info('uploadExample verified Play Integrity', {
        entryId: entryId || null,
        packageName: integritySummary.packageName,
        appRecognitionVerdict: integritySummary.appRecognitionVerdict,
        appLicensingVerdict: integritySummary.appLicensingVerdict,
        deviceRecognitionVerdict: integritySummary.deviceRecognitionVerdict,
        tokenAgeMs: integritySummary.tokenAgeMs,
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
      auth_mode: isDebugAuthenticated ? 'debug_token' : 'play_integrity',
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
      authMode: isDebugAuthenticated ? 'debug_token' : 'play_integrity',
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

async function verifyIntegrityToken({
  integrityToken,
  allowedPackageName,
  expectedRequestHash,
}) {
  const auth = new google.auth.GoogleAuth({
    scopes: [PLAY_INTEGRITY_SCOPE],
  });
  const authClient = await auth.getClient();
  const response = await authClient.request({
    url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(allowedPackageName)}:decodeIntegrityToken`,
    method: 'POST',
    data: {
      integrityToken,
    },
  });

  const verdict = response.data?.tokenPayloadExternal;
  const requestDetails = verdict?.requestDetails || {};
  const appIntegrity = verdict?.appIntegrity || {};
  const deviceRecognitionVerdict = verdict?.deviceIntegrity?.deviceRecognitionVerdict || [];
  const appLicensingVerdict = verdict?.accountDetails?.appLicensingVerdict;
  const timestampMillis = Number.parseInt(requestDetails.timestampMillis || '0', 10);
  const ageMs = Math.abs(Date.now() - timestampMillis);

  if (requestDetails.requestPackageName !== allowedPackageName) {
    throw withStatus(new Error('integrity_package_mismatch'), 401);
  }
  if (requestDetails.requestHash !== expectedRequestHash) {
    throw withStatus(new Error('integrity_request_hash_mismatch'), 401);
  }
  if (appIntegrity.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    throw withStatus(new Error('integrity_app_not_play_recognized'), 401);
  }
  if (appLicensingVerdict !== 'LICENSED') {
    throw withStatus(new Error('integrity_app_not_licensed'), 401);
  }
  if (!deviceRecognitionVerdict.some((value) => ACCEPTED_DEVICE_VERDICTS.has(value))) {
    throw withStatus(new Error('integrity_device_not_recognized'), 401);
  }
  if (!Number.isFinite(timestampMillis) || ageMs > MAX_TOKEN_AGE_MS) {
    throw withStatus(new Error('integrity_token_expired'), 401);
  }

   return {
    packageName: requestDetails.requestPackageName,
    appRecognitionVerdict: appIntegrity.appRecognitionVerdict,
    appLicensingVerdict,
    deviceRecognitionVerdict,
    tokenAgeMs: ageMs,
  };
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

function computeRequestHash({
  photoBytes,
  description,
  calorieEstimate,
  capturedAt,
  entryId,
  confidenceState,
}) {
  const digest = crypto.createHash('sha256');
  digest.update(photoBytes);
  digest.update(Buffer.from([0]));
  [
    description,
    String(calorieEstimate),
    capturedAt,
    entryId,
    confidenceState,
  ].forEach((value) => {
    digest.update(Buffer.from(value, 'utf8'));
    digest.update(Buffer.from([0]));
  });
  return digest.digest('base64');
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
