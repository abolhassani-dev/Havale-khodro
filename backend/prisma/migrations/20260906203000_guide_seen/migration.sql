-- When the agency first confirmed it has read the in-app guide. Null means
-- the panel still shows the guide before anything else.
ALTER TABLE "User" ADD COLUMN "guideSeenAt" TIMESTAMP(3);
