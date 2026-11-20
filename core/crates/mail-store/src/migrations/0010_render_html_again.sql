DELETE FROM email_body WHERE html IS NOT NULL;
UPDATE email SET body_state = 0 WHERE body_state = 2 AND id NOT IN (SELECT email_id FROM email_body);
