-- B1-012: only STOP (and its variants) consumes a message; HELP, INFO and START rows now get a request, so
-- /readyz counts them while they have none. Same columns as 0006 (IT-10 column list unchanged).
CREATE OR REPLACE VIEW inbound_health AS
  SELECT min(stored_at) AS oldest_without_request, count(*)::int AS without_request
  FROM inbound_messages WHERE request_id IS NULL AND keyword IS DISTINCT FROM 'stop' AND handled_as IS NULL;
