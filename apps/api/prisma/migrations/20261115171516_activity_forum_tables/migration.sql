-- CreateTable
CREATE TABLE "activity_forum_threads" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_forum_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_forum_posts" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_forum_threads_activity_id_created_at_id_idx" ON "activity_forum_threads"("activity_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "activity_forum_threads_author_id_idx" ON "activity_forum_threads"("author_id");

-- CreateIndex
CREATE INDEX "activity_forum_posts_thread_id_created_at_id_idx" ON "activity_forum_posts"("thread_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "activity_forum_posts_author_id_idx" ON "activity_forum_posts"("author_id");

-- AddForeignKey
ALTER TABLE "activity_forum_threads" ADD CONSTRAINT "activity_forum_threads_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_forum_threads" ADD CONSTRAINT "activity_forum_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_forum_posts" ADD CONSTRAINT "activity_forum_posts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "activity_forum_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_forum_posts" ADD CONSTRAINT "activity_forum_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
