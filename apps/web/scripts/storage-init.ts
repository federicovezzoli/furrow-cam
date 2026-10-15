/**
 * Prepares the mesh bucket (ADR-0029): creates it if it doesn't exist and lets
 * the app at BETTER_AUTH_URL upload to and download from it (CORS). Safe to
 * run again. `pnpm db:up` runs it for the local storage; run it once with the
 * production variables for a new bucket.
 */
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const {
  S3_ENDPOINT,
  S3_REGION,
  S3_BUCKET,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  BETTER_AUTH_URL,
} = process.env;

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.log("Storage isn't configured (S3_BUCKET and keys): nothing to do.");
  process.exit(0);
}
if (!BETTER_AUTH_URL) {
  console.error("Set BETTER_AUTH_URL: it is the origin allowed to upload.");
  process.exit(1);
}

const client = new S3Client({
  endpoint: S3_ENDPOINT || undefined,
  region: S3_REGION || "auto",
  forcePathStyle: Boolean(S3_ENDPOINT),
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
} catch (error) {
  // Another account's bucket of that name (`BucketAlreadyExists`) is an error.
  if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
}

const origin = new URL(BETTER_AUTH_URL).origin;
await client.send(
  new PutBucketCorsCommand({
    Bucket: S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [origin],
          AllowedMethods: ["GET", "PUT"],
          AllowedHeaders: ["content-type", "x-amz-checksum-sha256", "if-none-match"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`Bucket ${S3_BUCKET} is ready for uploads from ${origin}.`);
