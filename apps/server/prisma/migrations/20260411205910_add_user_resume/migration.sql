-- AlterTable
ALTER TABLE "SavedSearch" ALTER COLUMN "query" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resumeBulletEmbeddings" JSONB,
ADD COLUMN     "resumeBullets" JSONB,
ADD COLUMN     "resumeFileData" BYTEA,
ADD COLUMN     "resumeFileName" TEXT,
ADD COLUMN     "resumeText" TEXT,
ADD COLUMN     "resumeUpdatedAt" TIMESTAMP(3);
