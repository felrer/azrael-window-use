use crate::layout::Layout;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::oneshot;

const MAX_LINE: u64 = 16 * 1024 * 1024;
type Reply = Result<Value, String>;

pub struct Worker {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next_id: AtomicU64,
    pub stopping: AtomicBool,
    pub exited: AtomicBool,
    pub exiting: AtomicBool,
}

impl Worker {
    pub fn spawn(
        layout: &Layout,
        args: &[OsString],
    ) -> Result<(Arc<Self>, impl Read + Send + 'static), String> {
        let mut child = layout
            .command(args, true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = child.stdin.take().ok_or("Missing worker input")?;
        let output = child.stdout.take().ok_or("Missing worker output")?;
        Ok((
            Arc::new(Self {
                input: Mutex::new(input),
                child: Mutex::new(child),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                stopping: AtomicBool::new(false),
                exited: AtomicBool::new(false),
                exiting: AtomicBool::new(false),
            }),
            output,
        ))
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.input
            .lock()
            .map_err(|_| "Worker writer poisoned")?
            .write_all(&line)
            .map_err(|e| e.to_string())
    }

    pub async fn request(&self, method: &str, view: &str, params: Value) -> Reply {
        if self.exited.load(Ordering::Acquire) {
            return Err("Window Use service has exited".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "Worker replies poisoned")?
            .insert(id, tx);
        if let Err(error) = self.send(json!({"id":id,"method":method,"view":view,"params":params}))
        {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        // A native app chooser may remain open while the user decides.
        let result = tokio::time::timeout(Duration::from_secs(180), rx).await;
        self.pending.lock().unwrap().remove(&id);
        match result {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err("Window Use service disconnected".into()),
            Err(_) => Err("Window Use service request timed out".into()),
        }
    }

    pub fn resolve(&self, message: &Value) -> bool {
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return false;
        };
        let Some(tx) = self.pending.lock().unwrap().remove(&id) else {
            return false;
        };
        let result = if let Some(error) = message.get("error") {
            Err(format!(
                "{}: {}",
                error["code"].as_str().unwrap_or("host_error"),
                error["message"]
                    .as_str()
                    .unwrap_or("Window Use request failed")
            ))
        } else {
            Ok(message.get("result").cloned().unwrap_or(Value::Null))
        };
        let _ = tx.send(result);
        true
    }

    pub fn read(self: Arc<Self>, output: impl Read, event: impl Fn(Value) + Send + 'static) {
        let mut reader = BufReader::new(output);
        loop {
            let mut line = String::new();
            // Bound allocation before parsing; never execute malformed worker output.
            match reader.by_ref().take(MAX_LINE + 1).read_line(&mut line) {
                Ok(0) => break,
                Ok(_) if line.len() as u64 > MAX_LINE || !line.ends_with('\n') => break,
                Ok(_) => match serde_json::from_str::<Value>(&line) {
                    Ok(value) if value.is_object() => {
                        if !self.resolve(&value) {
                            event(value);
                        }
                    }
                    _ => break,
                },
                Err(_) => break,
            }
        }
        self.pending.lock().unwrap().clear();
        event(json!({"event":"workerPipeClosed"}));
    }

    pub fn monitor(self: Arc<Self>, exited: impl Fn(i32) + Send + 'static) {
        std::thread::spawn(move || loop {
            let result = self.child.lock().unwrap().try_wait();
            match result {
                Ok(Some(status)) => {
                    self.exited.store(true, Ordering::Release);
                    self.pending.lock().unwrap().clear();
                    exited(status.code().unwrap_or(1));
                    break;
                }
                Err(_) => {
                    self.exited.store(true, Ordering::Release);
                    exited(1);
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            }
        });
    }

    pub fn terminate(&self) {
        let _ = self.child.lock().unwrap().kill();
    }
}
