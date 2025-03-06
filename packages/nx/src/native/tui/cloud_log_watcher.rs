use crate::native::tui::action::Action;
use color_eyre::eyre::Result;
use log::debug;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::mpsc;
use watchexec::Watchexec;
use watchexec_events::{Event, Priority, Tag};
use watchexec_signals::Signal;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudLogEntry {
    pub content: String,
}

/// Log watcher that monitors a JSON file for changes
pub struct CloudLogWatcher {
    path: PathBuf,
    watchexec: Option<Arc<Watchexec>>,
    action_tx: Option<mpsc::UnboundedSender<Action>>,
}

impl CloudLogWatcher {
    pub fn new<P: AsRef<Path>>(path: P) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            watchexec: None,
            action_tx: None,
        }
    }

    pub fn set_action_sender(&mut self, tx: mpsc::UnboundedSender<Action>) {
        self.action_tx = Some(tx);
    }

    pub fn start_watching(&mut self) -> Result<()> {
        // Only start if we're not already watching
        if self.watchexec.is_some() {
            return Ok(());
        }

        // Create a new watchexec instance for the configured path
        let watchexec = Arc::new(Watchexec::default());
        let parent_dir = self.path.parent().unwrap_or(Path::new("."));
        watchexec.config.pathset([parent_dir.to_path_buf()]);

        let path = self.path.clone();
        let action_tx = self.action_tx.clone();

        watchexec.config.on_action(move |action| {
            let path_str = path.to_string_lossy().to_string();

            let is_relevant_update = path.exists()
                && action.events.iter().any(|event| {
                    // Check for a create or modify event
                    let has_file_event = event.tags.iter().any(|tag| {
                        if let Tag::FileEventKind(kind) = tag {
                            use watchexec_events::filekind::*;
                            matches!(
                                kind,
                                FileEventKind::Create(CreateKind::File)
                                    | FileEventKind::Modify(ModifyKind::Data(_))
                            )
                        } else {
                            false
                        }
                    });
                    // Check if the event is for our specific file
                    let is_target_file = event.paths().any(|(event_path, _)| {
                        let event_path_str = event_path.to_string_lossy().to_string();
                        event_path_str.ends_with(&path_str)
                    });
                    has_file_event && is_target_file
                });

            if is_relevant_update {
                // Read the file content and JSON parse it
                match fs::read_to_string(&path) {
                    Ok(content) => {
                        match serde_json::from_str::<CloudLogEntry>(&content) {
                            Ok(entry) => {
                                // Send the content to the app
                                if let Some(tx) = &action_tx {
                                    let _ = tx.send(Action::LogFileUpdated(entry.content));
                                }
                                // Delete the file after consuming it
                                if let Err(e) = fs::remove_file(&path) {
                                    debug!("Error deleting log file: {}", e);
                                }
                            }
                            Err(e) => {
                                debug!("Error parsing log entry: {}", e);
                                // Delete the file even if we couldn't parse it
                                if let Err(e) = fs::remove_file(&path) {
                                    debug!("Error deleting log file: {}", e);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        debug!("Error reading log file: {}", e);
                    }
                }
            }

            // Continue watching
            action
        });

        // Store the watchexec instance
        self.watchexec = Some(watchexec.clone());

        // Start watching
        tokio::spawn(async move {
            if let Err(e) = watchexec.main().await {
                debug!("Error in watchexec: {}", e);
            }
        });

        Ok(())
    }

    pub fn stop_watching(&mut self) {
        if let Some(watchexec) = self.watchexec.take() {
            // Send a terminate signal to the watchexec instance
            tokio::spawn(async move {
                if let Err(e) = watchexec
                    .send_event(
                        Event {
                            tags: vec![Tag::Signal(Signal::Terminate)],
                            metadata: HashMap::new(),
                        },
                        Priority::Urgent,
                    )
                    .await
                {
                    debug!("Error stopping watchexec: {}", e);
                }
            });
        }
    }
}

impl Drop for CloudLogWatcher {
    fn drop(&mut self) {
        self.stop_watching();
    }
}
