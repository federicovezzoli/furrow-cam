-- Data minimisation (ADR-0013): the name column mirrors the email.
UPDATE "user" SET "name" = "email";
