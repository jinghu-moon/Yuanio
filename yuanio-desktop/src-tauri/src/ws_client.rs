use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub ack_timeout_ms: u64,
    pub ack_max_retries: usize,
    pub offline_queue_max: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    Queued,
    Dropped,
}

#[derive(Debug, Clone)]
struct PendingAck {
    payload: String,
    deadline_ms: u64,
    retries: usize,
}

#[derive(Debug)]
pub struct RelayWsClientCore {
    connected: bool,
    offline_queue: Vec<String>,
    offline_queue_max: usize,
    pending_acks: HashMap<String, PendingAck>,
    ack_timeout_ms: u64,
    ack_max_retries: usize,
}

impl RelayWsClientCore {
    pub fn new(config: CoreConfig) -> Self {
        Self {
            connected: false,
            offline_queue: Vec::new(),
            offline_queue_max: config.offline_queue_max,
            pending_acks: HashMap::new(),
            ack_timeout_ms: config.ack_timeout_ms,
            ack_max_retries: config.ack_max_retries,
        }
    }

    pub fn set_connected(&mut self, connected: bool) -> Vec<String> {
        let was_connected = self.connected;
        self.connected = connected;
        if self.connected && (!was_connected || !self.offline_queue.is_empty()) {
            return std::mem::take(&mut self.offline_queue);
        }
        Vec::new()
    }

    pub fn enqueue_or_send(&mut self, payload: String) -> SendOutcome {
        if self.connected {
            return SendOutcome::Sent;
        }
        if self.offline_queue_max == 0 {
            return SendOutcome::Dropped;
        }
        self.offline_queue.push(payload);
        if self.offline_queue.len() > self.offline_queue_max {
            let overflow = self.offline_queue.len() - self.offline_queue_max;
            self.offline_queue.drain(0..overflow);
        }
        SendOutcome::Queued
    }

    pub fn track_reliable(&mut self, message_id: String, payload: String, now_ms: u64) {
        self.pending_acks.insert(message_id, PendingAck {
            payload,
            deadline_ms: now_ms.saturating_add(self.ack_timeout_ms),
            retries: 0,
        });
    }

    pub fn handle_ack(&mut self, message_id: &str, state: &str) -> bool {
        if state == "retry_after" {
            return false;
        }
        self.pending_acks.remove(message_id).is_some()
    }

    pub fn tick(&mut self, now_ms: u64) -> Vec<String> {
        let mut resend = Vec::new();
        let keys: Vec<String> = self.pending_acks
            .iter()
            .filter_map(|(key, value)| {
                if value.deadline_ms <= now_ms {
                    Some(key.clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys {
            let expired = match self.pending_acks.get(&key) {
                Some(value) => value.deadline_ms <= now_ms,
                None => false,
            };
            if !expired {
                continue;
            }

            let should_drop = match self.pending_acks.get(&key) {
                Some(value) => value.retries >= self.ack_max_retries,
                None => false,
            };
            if should_drop {
                self.pending_acks.remove(&key);
                continue;
            }

            if let Some(value) = self.pending_acks.get_mut(&key) {
                value.retries += 1;
                value.deadline_ms = now_ms.saturating_add(self.ack_timeout_ms);
                resend.push(value.payload.clone());
            }
        }
        resend
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core() -> RelayWsClientCore {
        RelayWsClientCore::new(CoreConfig {
            ack_timeout_ms: 10,
            ack_max_retries: 2,
            offline_queue_max: 4,
        })
    }

    #[test]
    fn offline_queue_flushes_on_connect() {
        let mut core = core();
        assert_eq!(core.enqueue_or_send("a".to_string()), SendOutcome::Queued);
        assert_eq!(core.enqueue_or_send("b".to_string()), SendOutcome::Queued);

        let flushed = core.set_connected(true);
        assert_eq!(flushed, vec!["a".to_string(), "b".to_string()]);
        assert!(core.offline_queue.is_empty());
    }

    #[test]
    fn ack_removes_pending() {
        let mut core = core();
        core.track_reliable("m1".to_string(), "payload".to_string(), 0);
        assert_eq!(core.pending_acks.len(), 1);
        assert!(core.handle_ack("m1", "ok"));
        assert_eq!(core.pending_acks.len(), 0);
    }

    #[test]
    fn reliable_send_retries_then_drops() {
        let mut core = core();
        core.track_reliable("m1".to_string(), "payload".to_string(), 0);

        let resend1 = core.tick(11);
        assert_eq!(resend1, vec!["payload".to_string()]);
        assert_eq!(core.pending_acks.get("m1").unwrap().retries, 1);

        let resend2 = core.tick(22);
        assert_eq!(resend2, vec!["payload".to_string()]);
        assert_eq!(core.pending_acks.get("m1").unwrap().retries, 2);

        let resend3 = core.tick(33);
        assert!(resend3.is_empty());
        assert!(core.pending_acks.get("m1").is_none());
    }
}
