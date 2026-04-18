-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discoverySearchesToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discoveryBonusFiveUsed" BOOLEAN NOT NULL DEFAULT false;
