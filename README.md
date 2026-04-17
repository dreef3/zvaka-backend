# Calorie Drive Upload API

HTTP serverless ingestion endpoint for meal-improvement data.

It accepts:
- a photo
- detected/confirmed description
- calorie estimate

It uploads both the image and a JSON sidecar to a Google Drive folder using a
Google service account. Infrastructure is provisioned with Terraform and the
function is deployed as a Node.js Cloud Run Function (Cloud Functions Gen 2).

## Layout

- `function-source/`: Node.js HTTP function
- `terraform/`: GCP resources, secrets, IAM, and function deployment

## Runtime contract

`POST /v1/examples`

Multipart form fields:
- `photo`: JPEG/PNG file
- `description`: text label
- `calorie_estimate`: integer
- `captured_at`: ISO-8601 timestamp, optional
- `entry_id`: app entry id, optional
- `confidence_state`: app confidence state, optional
- `integrity_token`: Play Integrity standard token bound to the request payload
- `debug_auth_token`: optional debug-build fallback token for sideloaded local builds

Response:

```json
{
  "ok": true,
  "photo_file_id": "drive-file-id",
  "metadata_file_id": "drive-file-id"
}
```

## Important Drive note

The service account does not automatically have access to your personal Google
Drive. After Terraform creates the runtime service account, share the target
Drive folder with that service account email.

## Deploy

1. Create `terraform/terraform.tfvars` from `terraform/terraform.tfvars.example`.
2. Put your Android package name in that file.
3. Run `terraform apply` once to create the runtime service account.
4. Share your Google Drive folder with that service account email.
5. Fill in `drive_folder_id`.
6. Run `terraform apply` again to deploy the upload function.
Commands:

```bash
cd terraform
terraform init
terraform apply
```

Terraform outputs the runtime service account email immediately. The function URL
becomes available after `drive_folder_id` is set and the second apply completes.

## Cost controls

- Terraform creates a billing budget on the linked billing account.
- Default thresholds are 50%, 90%, and 100% of the monthly budget.
- Default budget amount is `1 EUR` per month.
- The function is intentionally constrained to:
  - `256M` memory
  - `15s` timeout
  - `max_instance_count = 1`
- The source deployment bucket deletes objects older than 7 days.

Important:
- Budget alerts do not hard-stop usage by themselves.
- The strict runtime limits above reduce spend, but they do not guarantee zero
  paid usage if Google bills beyond free-tier allowances.

## Play Integrity notes

- The backend does not use a static bearer token.
- Each request must include a Play Integrity token whose `requestHash` matches
  the uploaded photo and metadata.
- The function currently requires `PLAY_RECOGNIZED`, `LICENSED`, and either
  `MEETS_DEVICE_INTEGRITY` or `MEETS_STRONG_INTEGRITY`.
- This is intended for Play-distributed builds. Locally sideloaded debug builds
  will generally not pass the same verdicts.
- For local debug builds, you can configure `debug_upload_token` in Terraform and
  have the app send `debug_auth_token` instead of a Play Integrity token.
