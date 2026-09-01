-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('SEDAN', 'HATCHBACK', 'SUV', 'PICKUP');

-- AlterTable
ALTER TABLE "CarModel" ADD COLUMN     "bodyType" "BodyType";
