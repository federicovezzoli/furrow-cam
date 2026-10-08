-- Data minimisation (ADR-0013): we no longer store names or avatars.
UPDATE "user" SET "name" = '', "image" = NULL;
