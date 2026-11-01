-- #437: machine accelerations for the time estimate; existing machines have none.
ALTER TABLE "machine" ADD COLUMN "accelerationXY" DOUBLE PRECISION,
ADD COLUMN "accelerationZ" DOUBLE PRECISION;
