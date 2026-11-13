export const BACKUP_HINTS: Record<string, string> = {
  s3: "Leave the endpoint blank; set the bucket's region.",
  r2: "Endpoint: https://<account-id>.r2.cloudflarestorage.com, region: auto",
  b2: "Endpoint: https://s3.<region>.backblazeb2.com",
  wasabi: "Endpoint: https://s3.<region>.wasabisys.com",
  gcs: "Endpoint: https://storage.googleapis.com. Use HMAC keys from Cloud Storage, Settings, Interoperability.",
  other: "Your provider's S3 endpoint.",
};
