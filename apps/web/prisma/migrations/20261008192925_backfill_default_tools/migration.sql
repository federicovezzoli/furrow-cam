-- Give accounts created before the default bit was seeded on sign-up the same
-- default bit (DEFAULT_TOOL in src/lib/tools.ts, as of this migration).
INSERT INTO "tool" (
    "id", "userId", "name", "type", "diameter", "fluteCount", "fluteLength", "cutDirection",
    "vAngle", "tipDiameter", "spindleRpm", "feedRate", "plungeRate", "stepDown", "stepOver",
    "notes", "color", "isDefault", "updatedAt"
)
SELECT
    gen_random_uuid()::text, u."id", '6 mm 2-flute upcut', 'flat_end_mill', 6, 2, 22, 'upcut',
    NULL, NULL, 24000, 600, 300, 1, 40,
    NULL, '#2563eb', true, CURRENT_TIMESTAMP
FROM "user" u
WHERE NOT EXISTS (SELECT 1 FROM "tool" t WHERE t."userId" = u."id");
