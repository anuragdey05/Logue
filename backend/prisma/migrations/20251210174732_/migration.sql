/*
  Warnings:

  - You are about to drop the column `ownerId` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the `DocumentMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentMember" DROP CONSTRAINT "DocumentMember_documentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentMember" DROP CONSTRAINT "DocumentMember_userId_fkey";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "ownerId";

-- DropTable
DROP TABLE "DocumentMember";

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "AuthProvider";

-- DropEnum
DROP TYPE "DocumentRole";
