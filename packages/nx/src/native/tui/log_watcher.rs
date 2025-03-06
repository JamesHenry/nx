use crate::native::tui::action::Action;
use color_eyre::eyre::Result;
use log::debug;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::{sync::mpsc, task::JoinHandle, time};

/// Simple log entry with just content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub content: String,
}

/// Log watcher that monitors a JSON file for changes
pub struct LogWatcher {
    entries: Arc<Mutex<Vec<LogEntry>>>,
    path: PathBuf,
    watcher_handle: Option<JoinHandle<()>>,
    _shutdown_tx: Option<mpsc::Sender<()>>,
    action_tx: Option<mpsc::UnboundedSender<Action>>,
}

impl LogWatcher {
    /// Create a new log watcher for the specified path
    pub fn new<P: AsRef<Path>>(path: P) -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            path: path.as_ref().to_path_buf(),
            watcher_handle: None,
            _shutdown_tx: None,
            action_tx: None,
        }
    }

    /// Set the action sender for the log watcher
    pub fn set_action_sender(&mut self, tx: mpsc::UnboundedSender<Action>) {
        self.action_tx = Some(tx);
    }

    /// Get the current log entries
    pub fn get_entries(&self) -> Vec<LogEntry> {
        let guard = self.entries.lock().unwrap();
        guard.clone()
    }

    /// Start watching the log file
    pub fn start_watching(&mut self) -> Result<()> {
        // Only start if we're not already watching
        if self.watcher_handle.is_some() {
            return Ok(());
        }

        // Don't process initial content - only react to changes
        // Record the path for watching
        let path = self.path.clone();
        let action_tx = self.action_tx.clone();

        // Create a channel to signal shutdown
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self._shutdown_tx = Some(shutdown_tx);

        // Start watching in a background task
        let handle = tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_millis(1000));

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Check if file exists
                        if path.exists() {
                            // Read the file content
                            match fs::read_to_string(&path) {
                                Ok(content) => {
                                    // Parse the JSON content
                                    match serde_json::from_str::<LogEntry>(&content) {
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
                                    eprintln!("Error reading log file: {}", e);
                                }
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        // Shutdown signal received
                        break;
                    }
                }
            }
        });

        self.watcher_handle = Some(handle);
        Ok(())
    }

    /// Stop watching the log file
    pub fn stop_watching(&mut self) {
        if let Some(handle) = self.watcher_handle.take() {
            // Signal the background task to stop
            if let Some(tx) = self._shutdown_tx.take() {
                let _ = tx.try_send(());
            }

            // Abort the task
            handle.abort();
        }
    }
}

impl Drop for LogWatcher {
    fn drop(&mut self) {
        self.stop_watching();
    }
}
