-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "actor" TEXT;

-- CreateTable
CREATE TABLE "AllowedUser" (
    "email" TEXT NOT NULL,
    "note" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "lastName" TEXT,

    CONSTRAINT "AllowedUser_pkey" PRIMARY KEY ("email")
);
