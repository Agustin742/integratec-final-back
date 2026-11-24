-- Allow standalone invitee/student accounts that hold zero school or workspace privileges until joining.
ALTER TYPE "registration_path" ADD VALUE IF NOT EXISTS 'invitee';
