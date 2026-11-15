ALTER TABLE team_members
  ADD CONSTRAINT team_members_team_user_role_unique
  UNIQUE (team_id, user_id, role);

ALTER TABLE teams
  ADD COLUMN leader_role TEXT NOT NULL DEFAULT 'leader'
  CONSTRAINT teams_leader_role_check CHECK (leader_role = 'leader');

ALTER TABLE teams
  ADD CONSTRAINT teams_leader_role_member_fk
  FOREIGN KEY (id, leader_id, leader_role)
  REFERENCES team_members (team_id, user_id, role)
  DEFERRABLE INITIALLY DEFERRED;
