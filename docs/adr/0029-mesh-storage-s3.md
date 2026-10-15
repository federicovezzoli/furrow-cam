# ADR-0029: Meshes are stored as project assets in S3-compatible storage

- **Status:** Proposed
- **Date:** 2026-10-15
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005, ADR-0003, ADR-0004, ADR-0005, ADR-0013, ADR-0028

## Context

PRD-0005 imports STL meshes into projects. An STL file ranges from hundreds of kilobytes to 50 MB (PRD-0005 S1). A project's contents are one JSON document (`Project.document`, ADR-0003) that autosave writes back in full through a server action, and server actions accept at most 4 MB (`apps/web/next.config.ts`). The same document is copied in full into every saved version (ADR-0028) and is the export file format (`.furrow.json`).

Furrow CAM is MIT-licensed and self-hostable; the public instance runs on Vercel and Neon (ADR-0005).

## Options considered

1. **Inline in the document** (e.g. base64). Pros: nothing new. Cons: breaks the 4 MB action limit, autosave rewrites the mesh on every edit, versions copy it each time, and the document becomes slow to parse and validate.
2. **A Postgres table of `bytea`**. Pros: no new service. Cons: uploads still need chunking around the 4 MB limit, meshes fill the database (Neon's storage is the scarcest resource), and backups grow with them.
3. **Vercel Blob**. Pros: least setup on the public instance, direct client uploads. Cons: ties self-hosters to Vercel, or needs a second adapter.
4. **S3-compatible object storage**. Pros: one API that Cloudflare R2, AWS S3, Backblaze B2 and MinIO all offer; presigned URLs let the browser upload and download directly. Cons: a new service and its credentials for every instance.

## Decision

We will use option 4:

- Meshes are **assets** identified by the **sha256 of their bytes**. The document refers to an asset by its hash, never by a URL, and records what the UI needs without downloading it (file name, size, triangle count, bounds).
- A `ProjectAsset` table holds `projectId` (cascade-deleted with its project), `sha256`, `size`, `verifiedAt` (`NULL` until the upload is verified) and `createdAt`, unique on `(projectId, sha256)`. The object key is `<userId>/<projectId>/<sha256>`: objects are never shared between projects, so nobody can reach another user's mesh by knowing its hash, and deleting one project can't affect another. The same file imported twice into one project is stored once.
- **Upload:** the client parses and checks the file (PRD-0005 S1) and hashes it, then asks a server action for an upload. The server checks ownership and the limits, records an unverified asset and returns a short-lived presigned `PUT` URL with the key, the size, the sha256 checksum (`x-amz-checksum-sha256`) and `If-None-Match: *` signed in, so the storage rejects other bytes and never overwrites an object. The client then asks the server to verify: it checks that the object exists with that size and checksum and sets `verifiedAt`. If the asset is already verified, nothing is uploaded.
- **Download:** a server action checks ownership and returns a short-lived presigned `GET` URL. The client caches meshes by hash.
- **Validation:** saving a document whose meshes reference a hash with no **verified** `ProjectAsset` row for the project is refused.
- **Lifetime:** assets belong to the project, not to a document, so saved versions (ADR-0028) keep working after the live document drops a mesh; an asset is never deleted while its project exists. Deleting the project deletes its rows, then the objects under its key prefix; deleting an account deletes the objects under the user's prefix (the rows cascade). Duplicating a project copies its verified objects (a server-side copy) and rows.
- **Export and import:** a project with meshes exports as a `.zip` holding the document and the meshes named by hash; one without meshes stays `.furrow.json`. Import creates the project first with an empty document, uploads and verifies the meshes as above, then saves the imported document; if any step fails, the project is deleted.
- **Configuration:** endpoint, region, bucket and credentials are environment variables (`apps/web/src/env.ts`). The public instance uses a Cloudflare R2 bucket with the **EU jurisdiction**, so meshes stay in the European Union like the app and database (Vercel and Neon in Frankfurt, ADR-0005); the jurisdiction is fixed when the bucket is created, and the endpoint is `https://<account id>.eu.r2.cloudflarestorage.com`. Local development uses RustFS in docker compose (MinIO no longer publishes images). `pnpm storage:init` creates the bucket and allows the app's origin to upload (CORS). Without storage configured, STL import is turned off and the rest of the app works.

## Consequences

- Every instance that wants STL import needs an S3-compatible bucket; self-hosters can pick any provider.
- Autosave and versions stay small: a mesh costs a few hundred bytes in the document.
- Storage costs grow with meshes and aren't covered by the freemium limits (PRD-0003) beyond the per-file cap; a quota needs its own PRD change.
- Meshes are user content, not personal data (ADR-0013), and are deleted with the project and the account. Cloudflare becomes a processor listed in the privacy policy.
- No deduplication across projects: the same file imported into two projects, or a duplicated project, is stored twice. That is the price of keeping projects isolated.
- The bucket must support the sha256 checksum and conditional `PUT` (checked against RustFS; R2 documents both for `PutObject`, still to be checked through a presigned URL before launch) and CORS for the app's origin.
- Unverified rows and objects (an upload that was abandoned) need a periodic clean-up, or are left until their project is deleted.
